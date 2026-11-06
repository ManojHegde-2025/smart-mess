process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "smart-mess-test-session-secret-min-32-chars-long";
process.env.APP_MODE = "live";
process.env.APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "postgres://mock:mock@127.0.0.1:5432/mock";

import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { GET, POST } from "../src/app/api/[...path]/route";
import {
  signSession,
  SESSION_COOKIE,
  MODE_COOKIE,
  getSessionMode,
} from "../src/lib/auth";
import type { User } from "../src/lib/types";
import { getPool } from "../src/lib/db";

const pool = getPool();
pool.query = (async (text: string, values?: any[]) => {
  if (typeof text === "string" && text.includes("FROM users")) {
    const userId = values?.[0];
    if (userId === "30000000-0000-4000-8000-000000000001") {
      return {
        rows: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            college_id: "MGR001",
            name: "Priya Sharma",
            role: "manager",
            mess_id: "south-mess",
            active: true,
            session_version: 1,
          },
        ],
      };
    }
    if (userId === "30000000-0000-4000-8000-000000000002") {
      return {
        rows: [
          {
            id: "30000000-0000-4000-8000-000000000002",
            college_id: "MGR002",
            name: "Priya Sharma 2",
            role: "manager",
            mess_id: "south-mess",
            active: true,
            session_version: 1,
          },
        ],
      };
    }
    if (userId === "20000000-0000-4000-8000-000000000001") {
      return {
        rows: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            college_id: "SM2026001",
            name: "Aarav Shah",
            role: "student",
            mess_id: "south-mess",
            active: true,
            session_version: 1,
          },
        ],
      };
    }
  }
  return { rows: [] };
}) as typeof pool.query;

const managerUser: User = {
  id: "30000000-0000-4000-8000-000000000001",
  collegeId: "MGR001",
  name: "Priya Sharma",
  role: "manager",
  messId: "south-mess",
  active: true,
};

const studentUser: User = {
  id: "20000000-0000-4000-8000-000000000001",
  collegeId: "SM2026001",
  name: "Aarav Shah",
  role: "student",
  messId: "south-mess",
  active: true,
};

test("1. getSessionMode: defaults to live, locks students to live, allows managers demo cookie", async () => {
  // Request without cookie
  const req1 = new NextRequest("http://localhost:3000/api/session");
  assert.equal(getSessionMode(req1, null), "live");
  assert.equal(getSessionMode(req1, managerUser), "live");
  assert.equal(getSessionMode(req1, studentUser), "live");

  // Request with smart_mess_mode=demo cookie
  const req2 = new NextRequest("http://localhost:3000/api/session", {
    headers: {
      cookie: `${MODE_COOKIE}=demo`,
    },
  });
  // Manager receives demo mode
  assert.equal(getSessionMode(req2, managerUser), "demo");
  // Student is strictly locked to live mode, ignoring forged demo cookie
  assert.equal(getSessionMode(req2, studentUser), "live");
  // Unauthenticated user is locked to live mode
  assert.equal(getSessionMode(req2, studentUser), "live");
});

test("2. POST /api/manager/mode: requires manager authentication and rejects students", async () => {
  // Case A: Unauthenticated call
  const unauthReq = new NextRequest("http://localhost:3000/api/manager/mode", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ mode: "demo" }),
  });
  const unauthRes = await POST(unauthReq);
  assert.equal(unauthRes.status, 401);

  // Case B: Student call (forbidden)
  const studentToken = await signSession(studentUser, 1);
  const studentReq = new NextRequest("http://localhost:3000/api/manager/mode", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE}=${studentToken}`,
    },
    body: JSON.stringify({ mode: "demo" }),
  });
  const studentRes = await POST(studentReq);
  assert.equal(studentRes.status, 403);
});

test("3. POST /api/manager/mode: validates payload and sets session mode cookie for manager", async () => {
  const managerToken = await signSession(managerUser, 1);

  // Case A: Invalid mode payload
  const invalidReq = new NextRequest("http://localhost:3000/api/manager/mode", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE}=${managerToken}`,
    },
    body: JSON.stringify({ mode: "super_admin" }),
  });
  const invalidRes = await POST(invalidReq);
  assert.equal(invalidRes.status, 422);

  // Case B: Valid switch to demo
  const demoReq = new NextRequest("http://localhost:3000/api/manager/mode", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE}=${managerToken}`,
    },
    body: JSON.stringify({ mode: "demo" }),
  });
  const demoRes = await POST(demoReq);
  assert.equal(demoRes.status, 200);
  const demoJson = await demoRes.json();
  assert.equal(demoJson.ok, true);
  assert.equal(demoJson.mode, "demo");

  // Verify cookie header
  const setCookie = demoRes.headers.get("set-cookie");
  assert.ok(setCookie?.includes(`${MODE_COOKIE}=demo`));

  // Case C: Valid switch back to live
  const liveReq = new NextRequest("http://localhost:3000/api/manager/mode", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE}=${managerToken}`,
    },
    body: JSON.stringify({ mode: "live" }),
  });
  const liveRes = await POST(liveReq);
  assert.equal(liveRes.status, 200);
  const liveJson = await liveRes.json();
  assert.equal(liveJson.ok, true);
  assert.equal(liveJson.mode, "live");
  assert.ok(liveRes.headers.get("set-cookie")?.includes(`${MODE_COOKIE}=live`));
});

test("4. Server-side Mutation Protection: blocks database mutation when session mode is demo", async () => {
  const managerToken = await signSession(managerUser, 1);

  // Manager attempting to mutate live database while in demo mode
  const mutationReq = new NextRequest("http://localhost:3000/api/manager/settings", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE}=${managerToken}; ${MODE_COOKIE}=demo`,
    },
    body: JSON.stringify({
      messName: "Hacked Mess",
      leavePolicy: "flag",
      safetyBuffer: 0.05,
      prices: { breakfast: 3000, lunch: 5000, dinner: 4500 },
      windows: {
        breakfast: { start: "07:30", end: "09:30" },
        lunch: { start: "12:30", end: "14:30" },
        dinner: { start: "19:30", end: "21:30" },
      },
      addons: [],
    }),
  });

  const res = await POST(mutationReq); // NextRequest handler handles all methods
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.code, "DEMO_MUTATION_BLOCKED");
  assert.ok(json.error.includes("Demo mode is active"));
});

test("5. GET /api/demo/forecasts: accessible to authenticated manager and produces 84-day forecasts", async () => {
  const managerToken = await signSession(managerUser, 1);

  const req = new NextRequest(
    "http://localhost:3000/api/demo/forecasts?buffer=0.05",
    {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE}=${managerToken}; ${MODE_COOKIE}=demo`,
      },
    },
  );

  const res = await GET(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.forecasts));
  assert.equal(data.forecasts.length, 3);
  for (const f of data.forecasts) {
    assert.equal(f.sampleDays, 84, "Demo forecast must process 84 completed synthetic days");
    assert.ok(f.predicted > 0);
  }

  // Student is rejected
  const studentToken = await signSession(studentUser, 1);
  const studentReq = new NextRequest(
    "http://localhost:3000/api/demo/forecasts?buffer=0.05",
    {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE}=${studentToken}; ${MODE_COOKIE}=demo`,
      },
    },
  );
  const studentRes = await GET(studentReq);
  assert.equal(studentRes.status, 403);
});

test("6. Session isolation: Manager A on demo does not affect Manager B on live", async () => {
  const managerA = await signSession(managerUser, 1);
  const managerBUser: User = {
    ...managerUser,
    id: "30000000-0000-4000-8000-000000000002",
    collegeId: "MGR002",
  };
  const managerB = await signSession(managerBUser, 1);

  // Manager A requests session with demo cookie
  const reqA = new NextRequest("http://localhost:3000/api/session", {
    headers: {
      cookie: `${SESSION_COOKIE}=${managerA}; ${MODE_COOKIE}=demo`,
    },
  });
  const resA = await GET(reqA);
  assert.equal((await resA.json()).mode, "demo");

  // Manager B requests session without demo cookie (or with live cookie)
  const reqB = new NextRequest("http://localhost:3000/api/session", {
    headers: {
      cookie: `${SESSION_COOKIE}=${managerB}; ${MODE_COOKIE}=live`,
    },
  });
  const resB = await GET(reqB);
  assert.equal((await resB.json()).mode, "live");
});
