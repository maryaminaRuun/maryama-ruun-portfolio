// Next.js glue for admin sign-in: cookies and the current session.
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { validateSession } from "./accounts";
import type { D1Like } from "../db/types";

export const SESSION_COOKIE = "mr_session";
export const MFA_COOKIE = "mr_mfa";
export const ENROLL_COOKIE = "mr_enroll";

/** HTTPS everywhere except local development. */
export function isSecureRequest(request?: Request, forwardedProto?: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  if (request) return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return process.env.NODE_ENV === "production";
}

/** `__Host-` cookies are locked to this exact host and path, and HTTPS only. */
export const cookieName = (base: string, secure: boolean) => (secure ? `__Host-${base}` : base);

export function setCookie(res: NextResponse, base: string, value: string, maxAgeSec: number, secure: boolean) {
  res.cookies.set(cookieName(base, secure), value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: maxAgeSec });
}

export function clearCookie(res: NextResponse, base: string, secure: boolean) {
  res.cookies.set(cookieName(base, secure), "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}

export function readCookie(request: Request, base: string): string | null {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    const k = part.slice(0, i);
    if (k === `__Host-${base}` || k === base) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

/** Session from the incoming request (route handlers). */
export async function sessionFromRequest(db: D1Like, request: Request) {
  return validateSession(db, readCookie(request, SESSION_COOKIE));
}

/** Session for server components (pages). */
export async function sessionFromCookies(db: D1Like) {
  const jar = await cookies();
  const token = jar.get(`__Host-${SESSION_COOKIE}`)?.value ?? jar.get(SESSION_COOKIE)?.value;
  return validateSession(db, token);
}

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null, userAgent: h.get("user-agent") };
}
