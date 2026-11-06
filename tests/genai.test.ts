import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import {
  generateMessInsights,
  insightInputSchema,
  insightSchema,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_FALLBACK_MODEL,
  UNAVAILABLE_MESSAGE,
  parseRetryAfter,
  calculateBackoffDelay,
  getPrimaryModel,
  getFallbackModel,
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

test("Primary model defaults to gemini-3.8-flash and fallback to gemini-3.5-flash-lite", () => {
  const savedPrimary = process.env.GEMINI_MODEL;
  const savedFallback = process.env.GEMINI_FALLBACK_MODEL;
  try {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
    assert.equal(getPrimaryModel(), DEFAULT_PRIMARY_MODEL);
    assert.equal(getFallbackModel(), DEFAULT_FALLBACK_MODEL);
    assert.equal(DEFAULT_PRIMARY_MODEL, "gemini-3.8-flash");
    assert.equal(DEFAULT_FALLBACK_MODEL, "gemini-3.5-flash-lite");

    process.env.GEMINI_MODEL = "custom-primary-model";
    process.env.GEMINI_FALLBACK_MODEL = "custom-fallback-model";
    assert.equal(getPrimaryModel(), "custom-primary-model");
    assert.equal(getFallbackModel(), "custom-fallback-model");

    // Overrides deprecated models
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    assert.equal(getPrimaryModel(), DEFAULT_PRIMARY_MODEL);
  } finally {
    if (savedPrimary !== undefined) process.env.GEMINI_MODEL = savedPrimary;
    else delete process.env.GEMINI_MODEL;
    if (savedFallback !== undefined) process.env.GEMINI_FALLBACK_MODEL = savedFallback;
    else delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test("Retry-After header parsing and backoff delay calculation", () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("10"), 3000); // capped at 3s
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("invalid"), null);

  const delay1 = calculateBackoffDelay(1, null);
  assert.equal(delay1 >= 400 && delay1 <= 700, true);

  const delayWithHeader = calculateBackoffDelay(1, "1");
  assert.equal(delayWithHeader, 1000);
});

test("Mock Gemini API returns valid JSON and parses successfully with primary model", async () => {
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

test("Retry logic: Primary model returns 503 on attempt 1, retries and succeeds on attempt 2", async () => {
  const mockResult = {
    summary: "Successful recovery after temporary 503.",
    demandAnalysis: "Demand steady.",
    wasteAnalysis: "Minimal waste.",
    recommendation: "Maintain buffer.",
    alerts: [],
  };

  let attempts = 0;
  const server = createServer((_req, res) => {
    attempts++;
    if (attempts === 1) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Model overloaded", status: "UNAVAILABLE" } }));
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

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    const insights = await generateMessInsights(sampleInput);
    assert.equal(insights.summary, mockResult.summary);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Fallback logic: Primary model 503 on all 3 attempts falls back to gemini-3.5-flash-lite and succeeds", async () => {
  const mockResult = {
    summary: "Fallback model produced insights after primary 503.",
    demandAnalysis: "Demand is tracking standard patterns.",
    wasteAnalysis: "Waste within bounds.",
    recommendation: "Operational buffer maintained.",
    alerts: ["[INFO] Served via fallback model."],
  };

  const requestedUrls: string[] = [];
  const server = createServer((req, res) => {
    requestedUrls.push(req.url ?? "");
    if (req.url?.includes("gemini-3.8-flash")) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Model capacity full", status: "UNAVAILABLE" } }));
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

  try {
    process.env.GEMINI_API_KEY = "test-mock-gemini-key";
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        return originalFetch(`http://127.0.0.1:${port}${new URL(urlStr).pathname}`, init);
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    const insights = await generateMessInsights(sampleInput);
    assert.equal(insights.summary, mockResult.summary);
    // Primary model attempted 3 times (attempt 1 + 2 retries), then fallback attempted once and succeeded
    const primaryCalls = requestedUrls.filter((u) => u.includes("gemini-3.8-flash"));
    const fallbackCalls = requestedUrls.filter((u) => u.includes("gemini-3.5-flash-lite"));
    assert.equal(primaryCalls.length, 3);
    assert.equal(fallbackCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Both models unavailable throws 503 with exact UNAVAILABLE_MESSAGE", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "High demand across models", status: "UNAVAILABLE" } }));
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
      (err: any) => err.status === 503 && err.message === UNAVAILABLE_MESSAGE,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Non-retryable client errors (HTTP 400, 401, 403) fail immediately without retry", async () => {
  let callCount = 0;
  const server = createServer((_req, res) => {
    callCount++;
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "API key invalid" } }));
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
    // Verified: No retries were attempted for authentication failure
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Rate limit HTTP 429 throws 429 GENAI_RATE_LIMITED", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Resource exhausted" } }));
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

test("Sanitization redacts secret key parameter from error message", async () => {
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
