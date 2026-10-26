import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { sql } from "drizzle-orm";
import { getDb, query, transaction } from "./db";
import { secret, userFromRow } from "./auth";
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
} from "./types";
import {
  addonSchema,
  ledgerSchema,
  settingsSchema,
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
      "SELECT *,starts_on::text,ends_on::text FROM leaves WHERE user_id=$1 ORDER BY leaves.starts_on DESC LIMIT 20",
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
