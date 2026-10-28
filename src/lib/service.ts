import {
  randomUUID,
  randomInt,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { sql } from "drizzle-orm";
import { getDb, query, transaction } from "./db";
import { hashPin, secret, userFromRow } from "./auth";
import { ApiError } from "./errors";
import { demandForecasts } from "./forecast";
import {
  defaultSettings,
  emptyCounts,
  inMealWindow,
  localTime,
} from "./domain";
import {
  MEALS,
  type Meal,
  type Settings,
  type User,
  type ScanResult,
  type StudentOverview,
  type ManagerOverview,
  type Usage,
  type MealEvent,
  type LeaveStatus,
  type PaginatedStudents,
} from "./types";
import {
  addonSchema,
  bulkImportSchema,
  cancelLeaveSchema,
  createStudentSchema,
  ledgerSchema,
  manualLeaveSchema,
  resetPinSchema,
  reviewLeaveSchema,
  settingsSchema,
  studentLeaveRequestSchema,
  updateStatusSchema,
  usageSchema,
  wardenSchema,
} from "./validation";
import type { z } from "zod";

export async function settings(messId: string): Promise<Settings> {
  const rows = await query("SELECT value FROM settings WHERE mess_id=$1", [
    messId,
  ]);
  return (
    rows[0]?.value ??
    defaultSettings(process.env.APP_TIME_ZONE ?? "Asia/Kolkata")
  );
}
function event(row: Record<string, unknown>): MealEvent {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    studentName: row.student_name ? String(row.student_name) : undefined,
    meal: row.meal as Meal,
    serviceDate: String(row.service_date),
    scannedAt: new Date(String(row.scanned_at)).toISOString(),
    decision: row.decision as MealEvent["decision"],
    reason: String(row.reason),
  };
}
export async function studentOverview(user: User): Promise<StudentOverview> {
  const config = await settings(user.messId);
  const [events, ledger, leaves, balance] = await Promise.all([
    query(
      "SELECT *,service_date::text FROM meal_events WHERE user_id=$1 ORDER BY scanned_at DESC LIMIT 40",
      [user.id],
    ),
    query(
      "SELECT * FROM ledger_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40",
      [user.id],
    ),
    query(
      "SELECT *,starts_on::text,ends_on::text,created_at::text FROM leaves WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40",
      [user.id],
    ),
    query(
      "SELECT COALESCE(sum(amount),0)::bigint AS balance FROM ledger_entries WHERE user_id=$1",
      [user.id],
    ),
  ]);
  return {
    user,
    settings: config,
    balance: Number(balance[0].balance),
    events: events.map(event),
    today: localTime(new Date(), config.timeZone).date,
    ledger: ledger.map((r) => ({
      id: r.id,
      userId: r.user_id,
      amount: r.amount,
      kind: r.kind,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    })),
    leaves: leaves.map((r) => ({
      id: r.id,
      userId: r.user_id,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      status: r.status,
      source: r.source,
      reason: r.reason ? String(r.reason) : undefined,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
    })),
  };
}
export async function issueQr(user: User, meal: Meal) {
  const config = await settings(user.messId);
  if (!config.configured)
    throw new ApiError(
      409,
      "Save the mess operational policy in Settings first.",
      "SETUP_REQUIRED",
    );
  const date = localTime(new Date(), config.timeZone).date;
  const token = await new SignJWT({ messId: user.messId, meal, date })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("smart-mess")
    .setAudience("meal-qr")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("90s")
    .sign(secret("QR_SECRET"));
  return {
    token,
    meal,
    date,
    messName: config.messName,
    expiresAt: new Date(Date.now() + 90000).toISOString(),
  };
}
export async function scanMeal(user: User, token: string): Promise<ScanResult> {
  const config = await settings(user.messId);
  const now = new Date();
  const local = localTime(now, config.timeZone);
  let payload;
  try {
    payload = (
      await jwtVerify(token, secret("QR_SECRET"), {
        algorithms: ["HS256"],
        issuer: "smart-mess",
        audience: "meal-qr",
      })
    ).payload;
  } catch {
    throw new ApiError(
      422,
      "This QR is invalid or expired. Scan the current counter QR.",
      "INVALID_QR",
    );
  }
  if (
    !MEALS.includes(payload.meal as Meal) ||
    typeof payload.messId !== "string" ||
    typeof payload.date !== "string"
  )
    throw new ApiError(422, "Invalid QR format.", "INVALID_QR");
  const meal = payload.meal as Meal;
  return transaction(async (client) => {
    const locked = await client.query(
      "SELECT active,mess_id FROM users WHERE id=$1 FOR UPDATE",
      [user.id],
    );
    if (!locked.rows[0]?.active)
      throw new ApiError(403, "Account is inactive.");
    let reason = "ACCEPTED";
    let message = "Meal recorded. Show this screen to the mess staff.";
    let warning: string | undefined;
    const leave = await client.query(
      "SELECT id FROM leaves WHERE user_id=$1 AND status='approved' AND starts_on<=$2 AND ends_on>=$2",
      [user.id, local.date],
    );
    const duplicate = await client.query(
      "SELECT id FROM meal_events WHERE user_id=$1 AND service_date=$2 AND meal=$3 AND decision='accepted'",
      [user.id, local.date, meal],
    );
    if (!config.configured) {
      reason = "SETUP_REQUIRED";
      message = "The mess policy has not been configured.";
    } else if (payload.messId !== locked.rows[0].mess_id) {
      reason = "WRONG_MESS";
      message = "This QR belongs to another mess.";
    } else if (
      payload.date !== local.date ||
      !inMealWindow(local.time, config.windows[meal])
    ) {
      reason = "OUTSIDE_WINDOW";
      message = "This meal service window is closed.";
    } else if (duplicate.rowCount) {
      reason = "DUPLICATE";
      message = "You have already recorded this meal today.";
    } else if (leave.rowCount && config.leavePolicy === "block") {
      reason = "APPROVED_LEAVE";
      message = "Approved leave is active. Please contact the office.";
    } else if (leave.rowCount) {
      reason = "LEAVE_FLAG";
      warning =
        "Approved leave is active. This meal is flagged for office review.";
    }
    const accepted = reason === "ACCEPTED" || reason === "LEAVE_FLAG";
    const id = randomUUID();
    await client.query(
      "INSERT INTO meal_events(id,user_id,mess_id,meal,service_date,scanned_at,decision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        user.id,
        user.messId,
        meal,
        local.date,
        now,
        accepted ? "accepted" : "rejected",
        reason,
      ],
    );
    if (accepted)
      await client.query(
        "INSERT INTO ledger_entries(id,user_id,amount,kind,note,reference,actor_id) VALUES($1,$2,$3,$4,$5,$6,$2)",
        [
          randomUUID(),
          user.id,
          -config.prices[meal],
          "meal",
          `${meal} · ${local.date}`,
          `meal:${id}`,
        ],
      );
    return {
      accepted,
      reason,
      message,
      name: user.name,
      meal,
      messName: config.messName,
      scannedAt: now.toISOString(),
      warning,
    };
  });
}
export async function managerOverview(user: User): Promise<ManagerOverview> {
  const config = await settings(user.messId);
  const today = localTime(new Date(), config.timeZone).date;
  const [
    students,
    counts,
    prepared,
    leaveCount,
    exceptions,
    historyRows,
    audit,
    pendingLeavesRows,
  ] = await Promise.all([
    query(
      "SELECT u.*,COALESCE(sum(l.amount),0)::bigint AS balance FROM users u LEFT JOIN ledger_entries l ON l.user_id=u.id WHERE u.mess_id=$1 AND u.role='student' GROUP BY u.id ORDER BY u.name",
      [user.messId],
    ),
    query(
      "SELECT meal,count(*)::int AS count FROM meal_events WHERE mess_id=$1 AND service_date=$2 AND decision='accepted' GROUP BY meal",
      [user.messId, today],
    ),
    query(
      "SELECT meal,prepared FROM meal_usage WHERE mess_id=$1 AND service_date=$2",
      [user.messId, today],
    ),
    query(
      "SELECT count(DISTINCT l.user_id)::int AS count FROM leaves l JOIN users u ON u.id=l.user_id WHERE u.mess_id=$1 AND u.active AND l.status='approved' AND l.starts_on<=$2 AND l.ends_on>=$2",
      [user.messId, today],
    ),
    query(
      "SELECT e.*,e.service_date::text,u.name AS student_name FROM meal_events e JOIN users u ON e.user_id=u.id WHERE e.mess_id=$1 AND e.service_date=$2 AND e.reason<>'ACCEPTED' ORDER BY scanned_at DESC LIMIT 30",
      [user.messId, today],
    ),
    query(
      `WITH served AS (SELECT service_date,meal,count(*)::int AS served FROM meal_events WHERE mess_id=$1 AND decision='accepted' AND service_date BETWEEN $2::date-180 AND $2::date GROUP BY service_date,meal), prepared AS (SELECT service_date,meal,prepared FROM meal_usage WHERE mess_id=$1 AND service_date BETWEEN $2::date-180 AND $2::date) SELECT COALESCE(s.service_date,p.service_date)::text AS date,COALESCE(s.meal,p.meal) AS meal,COALESCE(s.served,0) AS served,COALESCE(p.prepared,0) AS prepared FROM served s FULL JOIN prepared p USING(service_date,meal) ORDER BY date`,
      [user.messId, today],
    ),
    query(
      "SELECT a.*,COALESCE(u.name,'Warden integration') AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.mess_id=$1 ORDER BY a.created_at DESC LIMIT 20",
      [user.messId],
    ),
    query(
      "SELECT l.*,l.starts_on::text,l.ends_on::text,l.created_at::text,u.name AS student_name,u.college_id FROM leaves l JOIN users u ON u.id=l.user_id WHERE u.mess_id=$1 AND l.status='pending' ORDER BY l.created_at DESC LIMIT 30",
      [user.messId],
    ),
  ]);
  const history = historyRows as Usage[];
  const daily = emptyCounts(),
    prep = emptyCounts();
  counts.forEach((r) => (daily[r.meal as Meal] = r.count));
  prepared.forEach((r) => (prep[r.meal as Meal] = r.prepared));
  const forecasts = await demandForecasts(history, today, config.safetyBuffer);
  return {
    settings: config,
    today,
    students: students.map((r) => ({
      ...userFromRow(r),
      balance: Number(r.balance),
    })),
    activeStudents: students.filter((r) => r.active).length,
    counts: daily,
    prepared: prep,
    leaveCount: leaveCount[0].count,
    pendingLeaves: pendingLeavesRows.map((l) => ({
      id: String(l.id),
      userId: String(l.user_id),
      studentName: l.student_name ? String(l.student_name) : undefined,
      collegeId: l.college_id ? String(l.college_id) : undefined,
      startsOn: String(l.starts_on),
      endsOn: String(l.ends_on),
      status: l.status as LeaveStatus,
      source: String(l.source),
      reason: l.reason ? String(l.reason) : undefined,
      createdAt: l.created_at ? new Date(String(l.created_at)).toISOString() : undefined,
    })),
    exceptions: exceptions.map(event),
    history,
    forecasts,
    audit: audit.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      createdAt: r.created_at.toISOString(),
      detail: JSON.stringify(r.detail),
    })),
  };
}
export async function saveSettings(
  user: User,
  input: z.infer<typeof settingsSchema>,
) {
  const before = await settings(user.messId);
  const after = { ...input, configured: true, timeZone: before.timeZone };
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO settings(mess_id,value) VALUES($1,$2) ON CONFLICT(mess_id) DO UPDATE SET value=$2,updated_at=now()",
      [user.messId, JSON.stringify(after)],
    );
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        user.messId,
        user.id,
        "policy.updated",
        JSON.stringify({ before, after }),
      ],
    );
  });
  return { ok: true };
}
export async function saveUsage(
  user: User,
  input: z.infer<typeof usageSchema>,
) {
  const config = await settings(user.messId);
  if (input.date > localTime(new Date(), config.timeZone).date)
    throw new ApiError(
      422,
      "Prepared counts must be for today or an earlier date.",
    );
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO meal_usage(mess_id,service_date,meal,prepared,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(mess_id,service_date,meal) DO UPDATE SET prepared=$4,updated_by=$5,updated_at=now()",
      [user.messId, input.date, input.meal, input.prepared, user.id],
    );
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        user.messId,
        user.id,
        "preparation.updated",
        JSON.stringify(input),
      ],
    );
  });
  return { ok: true };
}
export async function adjustLedger(
  user: User,
  input: z.infer<typeof ledgerSchema>,
) {
  await transaction(async (c) => {
    const student = await c.query(
      "SELECT id FROM users WHERE id=$1 AND mess_id=$2 AND role='student'",
      [input.userId, user.messId],
    );
    if (!student.rowCount) throw new ApiError(404, "Student not found.");
    const reference = `adjustment:${input.requestId}`;
    const inserted = await c.query(
      "INSERT INTO ledger_entries(id,user_id,amount,kind,note,reference,actor_id) VALUES($1,$2,$3,'adjustment',$4,$5,$6) ON CONFLICT(reference) DO NOTHING RETURNING id",
      [
        randomUUID(),
        input.userId,
        input.amount,
        input.note,
        reference,
        user.id,
      ],
    );
    if (!inserted.rowCount) {
      const existing = await c.query(
        "SELECT user_id,amount,note FROM ledger_entries WHERE reference=$1",
        [reference],
      );
      if (
        existing.rows[0].user_id !== input.userId ||
        existing.rows[0].amount !== input.amount ||
        existing.rows[0].note !== input.note
      )
        throw new ApiError(
          409,
          "Request ID was already used with different data.",
        );
      return;
    }
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        user.messId,
        user.id,
        "ledger.adjusted",
        JSON.stringify(input),
      ],
    );
  });
  return { ok: true };
}
export async function orderAddon(
  user: User,
  input: z.infer<typeof addonSchema>,
) {
  const config = await settings(user.messId);
  if (!config.configured)
    throw new ApiError(409, "Mess policy is not configured.");
  const item = config.addons.find((a) => a.id === input.addonId);
  if (!item) throw new ApiError(404, "Add-on not found.");
  const note = `${input.quantity} × ${item.name}`;
  const amount = -item.price * input.quantity;
  await transaction(async (c) => {
    const reference = `addon:${user.id}:${input.requestId}`;
    const inserted = await c.query(
      "INSERT INTO ledger_entries(id,user_id,amount,kind,note,reference,actor_id) VALUES($1,$2,$3,'addon',$4,$5,$2) ON CONFLICT(reference) DO NOTHING RETURNING id",
      [randomUUID(), user.id, amount, note, reference],
    );
    if (!inserted.rowCount) {
      const row = (
        await c.query(
          "SELECT amount,note FROM ledger_entries WHERE reference=$1",
          [reference],
        )
      ).rows[0];
      if (row.amount !== amount || row.note !== note)
        throw new ApiError(409, "Request ID conflict.");
    }
  });
  return { ok: true };
}
export async function wardenWebhook(
  raw: string,
  timestamp: string | null,
  signature: string | null,
) {
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !signature ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    throw new ApiError(401, "Invalid webhook authentication.");
  const expected = createHmac("sha256", secret("WARDEN_WEBHOOK_SECRET"))
    .update(`${timestamp}.${raw}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex")))
    throw new ApiError(401, "Invalid webhook authentication.");
  const input = wardenSchema.parse(JSON.parse(raw));
  const hash = createHash("sha256").update(raw).digest("hex");
  return transaction(async (c) => {
    const inserted = await c.query(
      "INSERT INTO integration_events(id,payload_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
      [input.eventId, hash],
    );
    if (!inserted.rowCount) {
      const old = (
        await c.query(
          "SELECT payload_hash FROM integration_events WHERE id=$1",
          [input.eventId],
        )
      ).rows[0];
      if (old.payload_hash !== hash)
        throw new ApiError(409, "Webhook ID reused with different data.");
      return { ok: true, duplicate: true };
    }
    const student = (
      await c.query(
        "SELECT id,mess_id FROM users WHERE college_id=$1 AND role='student'",
        [input.collegeId.toUpperCase()],
      )
    ).rows[0];
    if (!student) throw new ApiError(404, "Student not found.");
    const prior = (
      await c.query("SELECT user_id FROM leaves WHERE external_id=$1", [
        input.leaveId,
      ])
    ).rows[0];
    if (prior && prior.user_id !== student.id)
      throw new ApiError(409, "Leave ID belongs to another student.");
    const updated = await c.query(
      "INSERT INTO leaves(id,external_id,user_id,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(external_id) DO UPDATE SET starts_on=$4,ends_on=$5,status=$6,updated_at=now() WHERE leaves.user_id=$3 RETURNING id",
      [
        randomUUID(),
        input.leaveId,
        student.id,
        input.startsOn,
        input.endsOn,
        input.status,
      ],
    );
    if (!updated.rowCount)
      throw new ApiError(409, "Leave ID belongs to another student.");
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,action,detail) VALUES($1,$2,'warden.leave-updated',$3)",
      [randomUUID(), student.mess_id, JSON.stringify(input)],
    );
    return { ok: true, duplicate: false };
  });
}
export async function databaseHealth() {
  await getDb().execute(sql`SELECT 1`);
  return { status: "ok" };
}

export async function paginatedStudents(
  manager: User,
  page = 1,
  limit = 25,
  search = "",
): Promise<PaginatedStudents> {
  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));
  const offset = (p - 1) * l;
  const term = search.trim();

  let countSql: string;
  let countParams: unknown[];
  let querySql: string;
  let queryParams: unknown[];

  if (term) {
    const searchPattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
    countSql =
      "SELECT count(*)::int AS total FROM users WHERE mess_id=$1 AND role='student' AND (name ILIKE $2 OR college_id ILIKE $2)";
    countParams = [manager.messId, searchPattern];
    querySql =
      "SELECT u.*,COALESCE(sum(l.amount),0)::bigint AS balance FROM users u LEFT JOIN ledger_entries l ON l.user_id=u.id WHERE u.mess_id=$1 AND u.role='student' AND (u.name ILIKE $2 OR u.college_id ILIKE $2) GROUP BY u.id ORDER BY u.name LIMIT $3 OFFSET $4";
    queryParams = [manager.messId, searchPattern, l, offset];
  } else {
    countSql =
      "SELECT count(*)::int AS total FROM users WHERE mess_id=$1 AND role='student'";
    countParams = [manager.messId];
    querySql =
      "SELECT u.*,COALESCE(sum(l.amount),0)::bigint AS balance FROM users u LEFT JOIN ledger_entries l ON l.user_id=u.id WHERE u.mess_id=$1 AND u.role='student' GROUP BY u.id ORDER BY u.name LIMIT $2 OFFSET $3";
    queryParams = [manager.messId, l, offset];
  }

  const [countRes, rows] = await Promise.all([
    query(countSql, countParams),
    query(querySql, queryParams),
  ]);

  const total = Number(countRes[0]?.total ?? 0);
  const totalPages = Math.ceil(total / l) || 1;

  return {
    students: rows.map((r) => ({
      ...userFromRow(r),
      balance: Number(r.balance),
    })),
    total,
    page: p,
    limit: l,
    totalPages,
  };
}

export async function createStudent(
  manager: User,
  input: z.infer<typeof createStudentSchema>,
) {
  const collegeId = input.collegeId.trim().toUpperCase();
  const messId = input.messId || manager.messId;

  const messRow = await query("SELECT id FROM messes WHERE id=$1", [messId]);
  if (!messRow.length) {
    throw new ApiError(400, "Assigned mess does not exist.");
  }

  const existing = await query("SELECT id FROM users WHERE college_id=$1", [
    collegeId,
  ]);
  if (existing.length) {
    throw new ApiError(409, "A student with this college ID already exists.");
  }

  const id = randomUUID();
  const pinHash = await hashPin(input.pin);

  await transaction(async (c) => {
    await c.query(
      "INSERT INTO users(id,college_id,name,role,mess_id,pin_hash,active,session_version) VALUES($1,$2,$3,'student',$4,$5,true,1)",
      [id, collegeId, input.name.trim(), messId, pinHash],
    );
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        manager.messId,
        manager.id,
        "student.created",
        JSON.stringify({ studentId: id, collegeId, name: input.name.trim(), messId }),
      ],
    );
  });

  return {
    ok: true,
    user: {
      id,
      collegeId,
      name: input.name.trim(),
      role: "student" as const,
      messId,
      active: true,
      balance: 0,
    },
  };
}

export async function resetStudentPin(
  manager: User,
  input: z.infer<typeof resetPinSchema>,
) {
  const student = (
    await query(
      "SELECT id,college_id FROM users WHERE id=$1 AND mess_id=$2 AND role='student'",
      [input.userId, manager.messId],
    )
  )[0];
  if (!student) throw new ApiError(404, "Student not found in this mess.");

  const pinHash = await hashPin(input.pin);

  await transaction(async (c) => {
    await c.query(
      "UPDATE users SET pin_hash=$1, session_version=session_version+1 WHERE id=$2",
      [pinHash, input.userId],
    );
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        manager.messId,
        manager.id,
        "student.pin-reset",
        JSON.stringify({ studentId: input.userId, collegeId: student.college_id }),
      ],
    );
  });

  return { ok: true };
}

export async function updateStudentStatus(
  manager: User,
  input: z.infer<typeof updateStatusSchema>,
) {
  const student = (
    await query(
      "SELECT id,college_id,active FROM users WHERE id=$1 AND mess_id=$2 AND role='student'",
      [input.userId, manager.messId],
    )
  )[0];
  if (!student) throw new ApiError(404, "Student not found in this mess.");

  await transaction(async (c) => {
    await c.query(
      "UPDATE users SET active=$1, session_version=CASE WHEN $1=false THEN session_version+1 ELSE session_version END WHERE id=$2",
      [input.active, input.userId],
    );
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        manager.messId,
        manager.id,
        "student.status-updated",
        JSON.stringify({
          studentId: input.userId,
          collegeId: student.college_id,
          active: input.active,
        }),
      ],
    );
  });

  return { ok: true, active: input.active };
}

export async function bulkImportStudents(
  manager: User,
  input: z.infer<typeof bulkImportSchema>,
) {
  const messes = new Set(
    (await query("SELECT id FROM messes")).map((r) => String(r.id)),
  );

  const seenIds = new Set<string>();
  const validRows: {
    collegeId: string;
    name: string;
    messId: string;
    pin: string;
  }[] = [];
  const errors: { row: number; collegeId: string; reason: string }[] = [];

  for (let i = 0; i < input.students.length; i++) {
    const s = input.students[i];
    const rowNum = i + 1;
    const cid = s.collegeId.trim().toUpperCase();
    const name = s.name.trim();
    const messId = s.messId || manager.messId;

    if (!cid) {
      errors.push({ row: rowNum, collegeId: cid, reason: "College ID is required" });
      continue;
    }
    if (seenIds.has(cid)) {
      errors.push({ row: rowNum, collegeId: cid, reason: "Duplicate college ID in import batch" });
      continue;
    }
    seenIds.add(cid);

    if (!messes.has(messId)) {
      errors.push({ row: rowNum, collegeId: cid, reason: `Unknown mess ID: ${messId}` });
      continue;
    }

    const pin = input.defaultPin || String(randomInt(100000, 1000000));
    validRows.push({ collegeId: cid, name, messId, pin });
  }

  if (validRows.length > 0) {
    const existing = await query(
      "SELECT college_id FROM users WHERE college_id = ANY($1)",
      [validRows.map((r) => r.collegeId)],
    );
    const existingSet = new Set(existing.map((r) => String(r.college_id)));
    for (let i = validRows.length - 1; i >= 0; i--) {
      if (existingSet.has(validRows[i].collegeId)) {
        errors.push({
          row: 0,
          collegeId: validRows[i].collegeId,
          reason: "College ID already registered in system",
        });
        validRows.splice(i, 1);
      }
    }
  }

  const credentials: { collegeId: string; name: string; pin: string }[] = [];

  if (validRows.length > 0) {
    await transaction(async (c) => {
      for (const row of validRows) {
        const id = randomUUID();
        const pinHash = await hashPin(row.pin);
        await c.query(
          "INSERT INTO users(id,college_id,name,role,mess_id,pin_hash,active,session_version) VALUES($1,$2,$3,'student',$4,$5,true,1)",
          [id, row.collegeId, row.name, row.messId, pinHash],
        );
        credentials.push({ collegeId: row.collegeId, name: row.name, pin: row.pin });
      }
      await c.query(
        "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          manager.messId,
          manager.id,
          "student.bulk-imported",
          JSON.stringify({
            count: validRows.length,
            errorCount: errors.length,
            collegeIds: validRows.map((r) => r.collegeId),
          }),
        ],
      );
    });
  }

  return {
    imported: validRows.length,
    errors,
    credentials,
  };
}

export async function requestLeave(
  student: User,
  input: z.infer<typeof studentLeaveRequestSchema>,
) {
  const overlap = await query(
    "SELECT id FROM leaves WHERE user_id=$1 AND status IN ('pending', 'approved') AND starts_on<=$3 AND ends_on>=$2",
    [student.id, input.startsOn, input.endsOn],
  );
  if (overlap.length > 0) {
    throw new ApiError(
      409,
      "You already have a pending or approved leave covering this period.",
    );
  }

  const id = randomUUID();
  const externalId = `req:${id}`;

  await query(
    "INSERT INTO leaves(id,external_id,user_id,starts_on,ends_on,status,source,reason) VALUES($1,$2,$3,$4,$5,'pending','student_request',$6)",
    [id, externalId, student.id, input.startsOn, input.endsOn, input.reason ?? null],
  );

  return { ok: true, id };
}

export async function cancelLeave(
  student: User,
  input: z.infer<typeof cancelLeaveSchema>,
) {
  const row = (
    await query("SELECT id,status FROM leaves WHERE id=$1 AND user_id=$2", [
      input.leaveId,
      student.id,
    ])
  )[0];
  if (!row) throw new ApiError(404, "Leave request not found.");
  if (row.status !== "pending") {
    throw new ApiError(400, "Only pending leave requests can be cancelled.");
  }

  await query("UPDATE leaves SET status='cancelled', updated_at=now() WHERE id=$1", [
    input.leaveId,
  ]);

  return { ok: true };
}

export async function reviewLeave(
  manager: User,
  input: z.infer<typeof reviewLeaveSchema>,
) {
  const leave = (
    await query(
      "SELECT l.id,l.user_id,u.mess_id FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.id=$1 AND u.mess_id=$2 AND l.status='pending'",
      [input.leaveId, manager.messId],
    )
  )[0];
  if (!leave) {
    throw new ApiError(404, "Pending leave request not found in your mess.");
  }

  await transaction(async (c) => {
    await c.query("UPDATE leaves SET status=$1, updated_at=now() WHERE id=$2", [
      input.status,
      input.leaveId,
    ]);
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        manager.messId,
        manager.id,
        `leave.${input.status}`,
        JSON.stringify({ leaveId: input.leaveId, status: input.status, studentId: leave.user_id }),
      ],
    );
  });

  return { ok: true, status: input.status };
}

export async function manualLeave(
  manager: User,
  input: z.infer<typeof manualLeaveSchema>,
) {
  const student = (
    await query(
      "SELECT id,college_id FROM users WHERE id=$1 AND mess_id=$2 AND role='student'",
      [input.userId, manager.messId],
    )
  )[0];
  if (!student) throw new ApiError(404, "Student not found in your mess.");

  const overlap = await query(
    "SELECT id FROM leaves WHERE user_id=$1 AND status='approved' AND starts_on<=$3 AND ends_on>=$2",
    [input.userId, input.startsOn, input.endsOn],
  );
  if (overlap.length > 0) {
    throw new ApiError(
      409,
      "Student already has an approved leave covering this period.",
    );
  }

  const id = randomUUID();
  const externalId = `man:${id}`;

  await transaction(async (c) => {
    await c.query(
      "INSERT INTO leaves(id,external_id,user_id,starts_on,ends_on,status,source,reason) VALUES($1,$2,$3,$4,$5,'approved','manager_manual',$6)",
      [id, externalId, input.userId, input.startsOn, input.endsOn, input.reason],
    );
    await c.query(
      "INSERT INTO audit_logs(id,mess_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        manager.messId,
        manager.id,
        "leave.manual-approved",
        JSON.stringify({
          leaveId: id,
          studentId: input.userId,
          collegeId: student.college_id,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          reason: input.reason,
        }),
      ],
    );
  });

  return { ok: true, id };
}
