import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import {
  generateMessInsights,
  insightInputSchema,
  insightSchema,
  type InsightInput,
} from "../src/lib/genai";
import { POST } from "../src/app/api/[...path]/route";
import { secret, SESSION_COOKIE } from "../src/lib/auth";

const sampleInput: InsightInput = {
  messName: "South Mess",
  date: "2026-11-06",
  forecasts: [
    {
      meal: "breakfast",
      predicted: 335,
      prepare: 352,
      method: "XGBoost Regressor",
      mae: 61.0,
      status: "selected",
    },
    {
      meal: "lunch",
      predicted: 413,
      prepare: 434,
      method: "XGBoost Regressor",
      mae: 65.63,
      status: "selected",
    },
    {
      meal: "dinner",
      predicted: 390,
      prepare: 410,
      method: "XGBoost Regressor",
      mae: 64.2,
      status: "selected",
    },
  ],
  counts: { breakfast: 320, lunch: 410, dinner: 385 },
  prepared: { breakfast: 350, lunch: 430, dinner: 405 },
  leaveCount: 12,
  exceptionCount: 2,
  recentUsage: [
    { date: "2026-11-05", meal: "breakfast", prepared: 340, served: 318 },
    { date: "2026-11-05", meal: "lunch", prepared: 430, served: 412 },
    { date: "2026-11-05", meal: "dinner", prepared: 400, served: 388 },
  ],
};

test("GenAI input schema validates structured payload and rejects malformed fields", () => {
  assert.equal(insightInputSchema.safeParse(sampleInput).success, true);
  // Rejects invalid date
  assert.equal(
    insightInputSchema.safeParse({ ...sampleInput, date: "invalid-date" }).success,
    false,
  );
  // Rejects negative counts
  assert.equal(
    insightInputSchema.safeParse({ ...sampleInput, counts: { breakfast: -10 } }).success,
    false,
  );
  // Rejects empty messName
  assert.equal(
    insightInputSchema.safeParse({ ...sampleInput, messName: "" }).success,
    false,
  );
});

test("GenAI output schema validates required keys and enforces maximum 5 alerts", () => {
  const validOutput = {
    summary: "Demand is tracking close to XGBoost forecasts with steady attendance across all meals.",
    demandAnalysis: "XGBoost predicts 413 meals for lunch, reflecting standard Friday patterns.",
    wasteAnalysis: "Preparation margins remained within 5-8% over served counts with minimal over-preparation.",
    recommendation: "Maintain the 5% safety buffer for tomorrow's lunch service.",
    alerts: [
      "[INFO] Breakfast attendance was within 3% of predicted demand.",
      "[WARNING] Check dinner prep buffer if Friday evening leaves increase.",
    ],
  };
  assert.equal(insightSchema.safeParse(validOutput).success, true);

  // Rejects output with more than 5 alerts
  const tooManyAlerts = {
    ...validOutput,
    alerts: ["1", "2", "3", "4", "5", "6"],
  };
  assert.equal(insightSchema.safeParse(tooManyAlerts).success, false);

  // Rejects output missing required summary
  const missingSummary = { ...validOutput, summary: "" };
  assert.equal(insightSchema.safeParse(missingSummary).success, false);
});

test("Missing GEMINI_API_KEY throws 503 SERVICE_UNAVAILABLE gracefully", async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      async () => generateMessInsights(sampleInput),
      (err: any) => err.status === 503 && err.code === "SERVICE_UNAVAILABLE",
    );
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
});

test("Mock Gemini API returns valid JSON and parses successfully", async () => {
  const mockResult = {
    summary: "XGBoost demand predictions align with recent attendance trends.",
    demandAnalysis: "Lunch demand peaked on Thursday at 410 meals; Friday forecast expects 413.",
    wasteAnalysis: "Over-preparation remained under 6% on average.",
    recommendation: "Review evening leave totals before setting Saturday dinner prep.",
    alerts: ["[INFO] Friday lunch attendance is expected to be highest this week."],
  };

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockResult) }],
            },
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key-1234567890123456";
    // Redirect fetch to local mock server
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    const insights = await generateMessInsights(sampleInput);
    assert.equal(insights.summary, mockResult.summary);
    assert.equal(insights.recommendation, mockResult.recommendation);
    assert.equal(insights.alerts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Mock Gemini API response wrapped in markdown code fence parses cleanly", async () => {
  const mockResult = {
    summary: "Executive briefing: stable attendance patterns observed.",
    demandAnalysis: "XGBoost predicts consistent attendance across all services.",
    wasteAnalysis: "Preparation exceeded served by less than 5%.",
    recommendation: "Maintain current preparation buffer.",
    alerts: ["[INFO] All operations normal."],
  };

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    // Wrapped in ```json ... ```
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: `\`\`\`json\n${JSON.stringify(mockResult)}\n\`\`\`` }],
            },
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key-1234567890123456";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    const insights = await generateMessInsights(sampleInput);
    assert.equal(insights.summary, mockResult.summary);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Mock Gemini API returning invalid JSON throws 502 GENAI_INVALID_JSON", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "This is not JSON at all." }],
            },
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key-1234567890123456";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    await assert.rejects(
      async () => generateMessInsights(sampleInput),
      (err: any) => err.status === 502 && err.code === "GENAI_INVALID_JSON",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Mock Gemini API HTTP 500 throws 502 GENAI_ERROR", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Internal server error" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key-1234567890123456";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    await assert.rejects(
      async () => generateMessInsights(sampleInput),
      (err: any) => err.status === 502 && err.code === "GENAI_ERROR",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Security: /api/manager/ai-insights rejects unauthenticated requests with 401", async () => {
  const originalMode = process.env.APP_MODE;
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_MODE = "live";
  process.env.APP_URL = "http://localhost:3000";
  try {
    const req = new NextRequest("http://localhost:3000/api/manager/ai-insights", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "UNAUTHENTICATED");
  } finally {
    process.env.APP_MODE = originalMode;
    if (originalAppUrl !== undefined) process.env.APP_URL = originalAppUrl;
    else delete process.env.APP_URL;
  }
});

test("Security: /api/manager/ai-insights rejects student role with 403 FORBIDDEN", async () => {
  const originalMode = process.env.APP_MODE;
  const originalAppUrl = process.env.APP_URL;
  const originalSecret = process.env.SESSION_SECRET;
  process.env.APP_MODE = "live";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = "test-session-secret-is-at-least-32-characters-long";
  const studentToken = await new SignJWT({ role: "student", version: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("10000000-0000-4000-8000-000000000001")
    .setIssuer("smart-mess")
    .setAudience("session")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret("SESSION_SECRET"));

  // Mock database query to return active student
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://mock:mock@127.0.0.1:5432/mock";
  const { getPool, closePool } = await import("../src/lib/db");
  const pool = getPool();
  const origQuery = pool.query.bind(pool);
  pool.query = (async (text: string) => {
    if (text.includes("FROM users")) {
      return {
        rows: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            college_id: "SM2026001",
            name: "Test Student",
            role: "student",
            mess_id: "south-mess",
            active: true,
            session_version: 1,
          },
        ],
      };
    }
    return { rows: [] };
  }) as typeof pool.query;

  try {
    const req = new NextRequest("http://localhost:3000/api/manager/ai-insights", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: `${SESSION_COOKIE}=${studentToken}`,
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "FORBIDDEN");
  } finally {
    pool.query = origQuery;
    await closePool();
    process.env.APP_MODE = originalMode;
    if (originalAppUrl !== undefined) process.env.APP_URL = originalAppUrl;
    else delete process.env.APP_URL;
    if (originalSecret !== undefined) process.env.SESSION_SECRET = originalSecret;
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
    else delete process.env.DATABASE_URL;
  }
});

test("Diagnostics: Mock Gemini API HTTP 404 triggers automatic fallback to fallback model", async () => {
  const mockResult = {
    summary: "Fallback model successfully produced operational summary.",
    demandAnalysis: "Demand patterns stable.",
    wasteAnalysis: "Waste remained minimal.",
    recommendation: "Keep current safety buffer.",
    alerts: [],
  };

  const requestedUrls: string[] = [];
  const server = createServer((req, res) => {
    requestedUrls.push(req.url ?? "");
    if (req.url?.includes("custom-unknown-model")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Model custom-unknown-model not found", status: "NOT_FOUND" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(mockResult) }] } }],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key";
    process.env.GEMINI_MODEL = "custom-unknown-model";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}${new URL(urlStr).pathname}?${new URL(urlStr).searchParams}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    const insights = await generateMessInsights(sampleInput);
    assert.equal(insights.summary, mockResult.summary);
    // Verified that both the initial model and fallback model were requested
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0].includes("custom-unknown-model"), true);
    assert.equal(requestedUrls[1].includes("gemini-3.5-flash"), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    if (originalModel) process.env.GEMINI_MODEL = originalModel;
    else delete process.env.GEMINI_MODEL;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Diagnostics: Mock Gemini API HTTP 429 returns 429 GENAI_RATE_LIMITED", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Resource exhausted: rate limit exceeded" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    await assert.rejects(
      async () => generateMessInsights(sampleInput),
      (err: any) => err.status === 429 && err.code === "GENAI_RATE_LIMITED",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Diagnostics: Mock Gemini API HTTP 403 returns 502 GENAI_AUTH_FAILED", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Permission denied for API key" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    await assert.rejects(
      async () => generateMessInsights(sampleInput),
      (err: any) => err.status === 502 && err.code === "GENAI_AUTH_FAILED",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Diagnostics: Sanitization redacts secret key parameter from error message", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid request for key=SECRET_KEY_12345 in parameter" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = "SECRET_KEY_12345";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    await assert.rejects(
      async () => generateMessInsights(sampleInput),
      (err: any) => {
        assert.equal(err.message.includes("SECRET_KEY_12345"), false);
        assert.equal(err.message.includes("key=[REDACTED]"), true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
