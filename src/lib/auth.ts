import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { query } from "./db";
import { ApiError } from "./errors";
import type { Role, User } from "./types";
const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "smart_mess_session";
export function appMode(): "demo" | "live" {
  const mode = process.env.APP_MODE ?? "demo";
  if (mode !== "demo" && mode !== "live")
    throw new Error("APP_MODE must be demo or live");
  return mode;
}
export function secret(
  name: "SESSION_SECRET" | "QR_SECRET" | "WARDEN_WEBHOOK_SECRET",
) {
  const value = process.env[name];
  if (!value || value.length < 32)
    throw new Error(`${name} must contain at least 32 random characters`);
  if (name === "QR_SECRET" && value === process.env.SESSION_SECRET)
    throw new Error("QR_SECRET must differ from SESSION_SECRET");
  return new TextEncoder().encode(value);
}
export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(pin, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPin(pin: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/.test(hash ?? "")
  )
    return false;
  const candidate = (await scrypt(pin, salt, 64)) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}
export async function signSession(user: User, version: number) {
  return new SignJWT({ role: user.role, version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("smart-mess")
    .setAudience("session")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret("SESSION_SECRET"));
}
export function userFromRow(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    collegeId: String(row.college_id),
    name: String(row.name),
    role: row.role as Role,
    messId: String(row.mess_id),
    active: Boolean(row.active),
  };
}
export async function actor(request: NextRequest): Promise<User> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, "Please sign in.", "UNAUTHENTICATED");
  let payload;
  try {
    payload = (
      await jwtVerify(token, secret("SESSION_SECRET"), {
        algorithms: ["HS256"],
        issuer: "smart-mess",
        audience: "session",
      })
    ).payload;
  } catch {
    throw new ApiError(
      401,
      "Your session has expired. Please sign in again.",
      "UNAUTHENTICATED",
    );
  }
  const rows = await query("SELECT * FROM users WHERE id=$1 AND active=true", [
    payload.sub,
  ]);
  if (!rows[0] || rows[0].session_version !== payload.version)
    throw new ApiError(401, "Please sign in again.", "UNAUTHENTICATED");
  return userFromRow(rows[0]);
}
export function requireRole(user: User, role: Role) {
  if (user.role !== role)
    throw new ApiError(
      403,
      "You do not have access to this action.",
      "FORBIDDEN",
    );
}
export function checkOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new ApiError(
      403,
      "Request origin did not match this application.",
      "INVALID_ORIGIN",
    );
}
export async function login(collegeId: string, pin: string) {
  const key = createHmac("sha256", secret("SESSION_SECRET"))
    .update(collegeId.toUpperCase())
    .digest("hex");
  const attempts = await query(
    `INSERT INTO login_attempts(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE login_attempts.count+1 END, window_start=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING count`,
    [key],
  );
  if (attempts[0].count > 10)
    throw new ApiError(
      429,
      "Too many attempts. Wait 15 minutes before trying again.",
      "RATE_LIMITED",
    );
  const rows = await query(
    "SELECT * FROM users WHERE college_id=$1 AND active=true",
    [collegeId.toUpperCase()],
  );
  // Always perform the expensive derivation so absent users follow the same path.
  const placeholder = `scrypt:${"00".repeat(16)}:${"00".repeat(64)}`;
  const valid = await verifyPin(pin, rows[0]?.pin_hash ?? placeholder);
  if (!rows[0] || !valid)
    throw new ApiError(401, "College ID or PIN is incorrect.", "INVALID_LOGIN");
  await query("DELETE FROM login_attempts WHERE key=$1", [key]);
  const user = userFromRow(rows[0]);
  return { user, token: await signSession(user, rows[0].session_version) };
}
