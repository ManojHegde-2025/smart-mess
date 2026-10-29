import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  actor,
  appMode,
  checkOrigin,
  login,
  requireRole,
  SESSION_COOKIE,
} from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import * as service from "@/lib/service";
import {
  addonSchema,
  bulkImportSchema,
  cancelLeaveSchema,
  createStudentSchema,
  ledgerSchema,
  loginSchema,
  manualLeaveSchema,
  mealSchema,
  paginationSchema,
  resetPinSchema,
  reviewLeaveSchema,
  scanSchema,
  settingsSchema,
  studentLeaveRequestSchema,
  updateStatusSchema,
  usageSchema,
} from "@/lib/validation";
import { localTime, reportCsv } from "@/lib/domain";
import { demoHistory } from "@/lib/demo-history";
import { demandForecasts } from "@/lib/forecast";
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
    // Public only in demo mode. The server supplies fixed synthetic history;
    // callers cannot submit student records, arbitrary training data, or a URL.
    if (
      appMode() === "demo" &&
      path === "/demo/forecasts" &&
      method === "GET"
    ) {
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
      const response = json({ user: result.user });
      response.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
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
      return response;
    }
    const user = await actor(request);
    if (path === "/session" && method === "GET") return json({ user });
    if (path === "/student/overview" && method === "GET") {
      requireRole(user, "student");
      return json(await service.studentOverview(user));
    }
    if (path === "/meals/scan" && method === "POST") {
      requireRole(user, "student");
      return json(
        await service.scanMeal(user, scanSchema.parse(await body()).token),
      );
    }
    if (path === "/addons" && method === "POST") {
      requireRole(user, "student");
      return json(
        await service.orderAddon(user, addonSchema.parse(await body())),
      );
    }
    if (path === "/student/leaves" && method === "POST") {
      requireRole(user, "student");
      return json(
        await service.requestLeave(
          user,
          studentLeaveRequestSchema.parse(await body()),
        ),
        201,
      );
    }
    if (path === "/student/leaves/cancel" && method === "POST") {
      requireRole(user, "student");
      return json(
        await service.cancelLeave(
          user,
          cancelLeaveSchema.parse(await body()),
        ),
      );
    }
    requireRole(user, "manager");
    if (path === "/manager/overview" && method === "GET") {
      const forecastSource = request.nextUrl.searchParams.get("forecastSource");
      return json(await service.managerOverview(user, forecastSource));
    }
    if (path === "/manager/students" && method === "GET") {
      const params = paginationSchema.parse({
        page: request.nextUrl.searchParams.get("page") ?? 1,
        limit: request.nextUrl.searchParams.get("limit") ?? 25,
        search: request.nextUrl.searchParams.get("search") ?? "",
      });
      return json(
        await service.paginatedStudents(
          user,
          params.page,
          params.limit,
          params.search,
        ),
      );
    }
    if (path === "/manager/students" && method === "POST") {
      return json(
        await service.createStudent(
          user,
          createStudentSchema.parse(await body()),
        ),
        201,
      );
    }
    if (path === "/manager/students/reset-pin" && method === "POST") {
      return json(
        await service.resetStudentPin(
          user,
          resetPinSchema.parse(await body()),
        ),
      );
    }
    if (path === "/manager/students/status" && method === "PATCH") {
      return json(
        await service.updateStudentStatus(
          user,
          updateStatusSchema.parse(await body()),
        ),
      );
    }
    if (path === "/manager/students/import" && method === "POST") {
      return json(
        await service.bulkImportStudents(
          user,
          bulkImportSchema.parse(await body()),
        ),
      );
    }
    if (path === "/manager/leaves/review" && method === "PATCH") {
      return json(
        await service.reviewLeave(
          user,
          reviewLeaveSchema.parse(await body()),
        ),
      );
    }
    if (path === "/manager/leaves/manual" && method === "POST") {
      return json(
        await service.manualLeave(
          user,
          manualLeaveSchema.parse(await body()),
        ),
        201,
      );
    }
    if (path === "/manager/qr" && method === "GET")
      return json(
        await service.issueQr(
          user,
          mealSchema.parse(request.nextUrl.searchParams.get("meal")),
        ),
      );
    if (path === "/manager/settings" && method === "PATCH")
      return json(
        await service.saveSettings(user, settingsSchema.parse(await body())),
      );
    if (path === "/manager/usage" && method === "POST")
      return json(
        await service.saveUsage(user, usageSchema.parse(await body())),
      );
    if (path === "/manager/ledger" && method === "POST")
      return json(
        await service.adjustLedger(user, ledgerSchema.parse(await body())),
      );
    if (path === "/reports/daily" && method === "GET") {
      const forecastSource = request.nextUrl.searchParams.get("forecastSource");
      const data = await service.managerOverview(user, forecastSource);
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
