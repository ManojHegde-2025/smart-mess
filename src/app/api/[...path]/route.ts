import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  actor,
  appMode,
  checkOrigin,
  login,
  requireRole,
  SESSION_COOKIE,
  MODE_COOKIE,
  getSessionMode,
} from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import * as service from "@/lib/service";
import {
  addonSchema,
  ledgerSchema,
  loginSchema,
  mealSchema,
  scanSchema,
  settingsSchema,
  usageSchema,
} from "@/lib/validation";
import { defaultSettings, localTime, reportCsv } from "@/lib/domain";
import { demoHistory } from "@/lib/demo-history";
import { demandForecasts } from "@/lib/forecast";
import {
  generateMessInsights,
  insightInputSchema,
  type InsightInput,
} from "@/lib/genai";
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
async function readBody(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 65536) throw new ApiError(413, "Request is too large.");
  return raw;
}
const demoAiRateLimit = new Map<string, { count: number; windowStart: number }>();
function checkDemoAiRateLimit(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "client";
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxRequests = 5;
  const record = demoAiRateLimit.get(ip);
  if (!record || now - record.windowStart > windowMs) {
    demoAiRateLimit.set(ip, { count: 1, windowStart: now });
  } else {
    if (record.count >= maxRequests) {
      throw new ApiError(
        429,
        "Too many AI insight requests in demo mode. Please wait a few minutes before trying again.",
        "RATE_LIMITED",
      );
    }
    record.count++;
  }
}
const managerAiRateLimit = new Map<string, { count: number; windowStart: number }>();
function checkManagerAiRateLimit(userId: string) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 6;
  const record = managerAiRateLimit.get(userId);
  if (!record || now - record.windowStart > windowMs) {
    managerAiRateLimit.set(userId, { count: 1, windowStart: now });
  } else {
    if (record.count >= maxRequests) {
      throw new ApiError(
        429,
        "Too many AI insight requests. Please wait a moment before refreshing.",
        "RATE_LIMITED",
      );
    }
    record.count++;
  }
}
async function handler(request: NextRequest) {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api/, "");
    const method = request.method;
    if (path === "/health" && method === "GET")
      return json(
        appMode() === "demo"
          ? { status: "ok", mode: "demo" }
          : { ...(await service.databaseHealth()), mode: "live" },
      );
    // Available in standalone demo mode or to authenticated managers in live mode
    if (path === "/demo/ai-insights" && method === "POST") {
      if (appMode() !== "demo") {
        const user = await actor(request);
        requireRole(user, "manager");
      }
      checkOrigin(request);
      checkDemoAiRateLimit(request);
      const raw = await readBody(request);
      let input: InsightInput;
      let parsed: any = null;
      try {
        parsed = raw && raw.trim() !== "" ? JSON.parse(raw) : null;
      } catch {}
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.messName &&
        Array.isArray(parsed.forecasts)
      ) {
        input = insightInputSchema.parse(parsed);
      } else {
        const today = localTime().date;
        const config = defaultSettings();
        const history = demoHistory(today);
        const forecasts = await demandForecasts(history, today, config.safetyBuffer);
        input = {
          messName: `${config.messName} (Demo)`,
          date: today,
          forecasts: forecasts.map((f) => ({
            meal: f.meal,
            predicted: f.predicted,
            prepare: f.prepare,
            method: f.method,
            mae: f.mae,
            status: f.mlStatus,
          })),
          counts: { breakfast: 33, lunch: 42, dinner: 0 },
          prepared: { breakfast: 37, lunch: 46, dinner: 40 },
          leaveCount: 4,
          exceptionCount: 3,
          recentUsage: history.slice(-21),
        };
      }
      return json(await generateMessInsights(input));
    }
    if (path === "/demo/forecasts" && method === "GET") {
      if (appMode() !== "demo") {
        const user = await actor(request);
        requireRole(user, "manager");
      }
      const buffer = z.coerce
        .number()
        .min(0)
        .max(0.5)
        .parse(request.nextUrl.searchParams.get("buffer") ?? 0.05);
      const today = localTime().date;
      return json({
        forecasts: await demandForecasts(demoHistory(today), today, buffer),
      });
    }
    if (appMode() === "demo")
      return json(
        {
          error:
            "Demo data lives only in your browser. Switch APP_MODE to live to enable these APIs.",
        },
        409,
      );
    if (path === "/warden/leave-status" && method === "POST")
      return json(
        await service.wardenWebhook(
          await readBody(request),
          request.headers.get("x-warden-timestamp"),
          request.headers.get("x-warden-signature"),
        ),
      );
    if (!["GET", "HEAD"].includes(method)) checkOrigin(request);
    const body = async () => JSON.parse(await readBody(request));
    if (path === "/auth/login" && method === "POST") {
      const input = loginSchema.parse(await body());
      const result = await login(input.collegeId, input.pin);
      const response = json({ user: result.user, mode: "live" });
      response.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
      response.cookies.set(MODE_COOKIE, "live", {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
      return response;
    }
    if (path === "/auth/logout" && method === "POST") {
      const response = json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      response.cookies.set(MODE_COOKIE, "", {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    const user = await actor(request);
    const sessionMode = getSessionMode(request, user);
    if (path === "/session" && method === "GET")
      return json({ user, mode: sessionMode });
    if (path === "/manager/mode" && method === "POST") {
      requireRole(user, "manager");
      const input = z
        .object({ mode: z.enum(["live", "demo"]) })
        .parse(await body());
      const response = json({ ok: true, mode: input.mode });
      response.cookies.set(MODE_COOKIE, input.mode, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
      return response;
    }
    if (path === "/student/overview" && method === "GET") {
      requireRole(user, "student");
      return json(await service.studentOverview(user));
    }
    if (path === "/meals/scan" && method === "POST") {
      requireRole(user, "student");
      if (sessionMode === "demo") {
        throw new ApiError(
          409,
          "Demo mode is active. Database mutation blocked to protect production records.",
          "DEMO_MUTATION_BLOCKED",
        );
      }
      return json(
        await service.scanMeal(user, scanSchema.parse(await body()).token),
      );
    }
    if (path === "/addons" && method === "POST") {
      requireRole(user, "student");
      if (sessionMode === "demo") {
        throw new ApiError(
          409,
          "Demo mode is active. Database mutation blocked to protect production records.",
          "DEMO_MUTATION_BLOCKED",
        );
      }
      return json(
        await service.orderAddon(user, addonSchema.parse(await body())),
      );
    }
    requireRole(user, "manager");
    if (path === "/manager/ai-insights" && method === "POST") {
      checkManagerAiRateLimit(user.id);
      // In live mode, insights are strictly derived from genuine database records.
      // Client-supplied input is not accepted to guarantee that synthetic data cannot infiltrate live mode.
      const overview = await service.managerOverview(user);
      const input: InsightInput = {
        messName: overview.settings.messName,
        date: overview.today,
        forecasts: overview.forecasts.map((f) => ({
          meal: f.meal,
          predicted: f.predicted,
          prepare: f.prepare,
          method: f.method,
          mae: f.mae,
          status: f.mlStatus,
        })),
        counts: overview.counts,
        prepared: overview.prepared,
        leaveCount: overview.leaveCount,
        exceptionCount: overview.exceptions.length,
        recentUsage: overview.history.slice(-21),
      };
      return json(await generateMessInsights(input));
    }
    if (path === "/manager/overview" && method === "GET")
      return json(await service.managerOverview(user));
    if (path === "/manager/qr" && method === "GET")
      return json(
        await service.issueQr(
          user,
          mealSchema.parse(request.nextUrl.searchParams.get("meal")),
        ),
      );
    if (path === "/manager/settings" && method === "PATCH") {
      if (sessionMode === "demo") {
        throw new ApiError(
          409,
          "Demo mode is active. Database mutation blocked to protect production records.",
          "DEMO_MUTATION_BLOCKED",
        );
      }
      return json(
        await service.saveSettings(user, settingsSchema.parse(await body())),
      );
    }
    if (path === "/manager/usage" && method === "POST") {
      if (sessionMode === "demo") {
        throw new ApiError(
          409,
          "Demo mode is active. Database mutation blocked to protect production records.",
          "DEMO_MUTATION_BLOCKED",
        );
      }
      return json(
        await service.saveUsage(user, usageSchema.parse(await body())),
      );
    }
    if (path === "/manager/ledger" && method === "POST") {
      if (sessionMode === "demo") {
        throw new ApiError(
          409,
          "Demo mode is active. Database mutation blocked to protect production records.",
          "DEMO_MUTATION_BLOCKED",
        );
      }
      return json(
        await service.adjustLedger(user, ledgerSchema.parse(await body())),
      );
    }
    if (path === "/reports/daily" && method === "GET") {
      const data = await service.managerOverview(user);
      return new NextResponse(reportCsv(data.history), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="smart-mess-report.csv"',
          "cache-control": "private, no-store",
        },
      });
    }
    throw new ApiError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(";"),
        },
        422,
      );
    if (error instanceof SyntaxError)
      return json({ error: "Invalid JSON request." }, 400);
    // Do not log request bodies, PINs, connection strings, or secret-bearing errors.
    console.error(
      "Smart Mess request failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error: "Service unavailable. Check server configuration and try again.",
      },
      503,
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
