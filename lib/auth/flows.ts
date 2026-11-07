// Shared request logic for sign-in and enrollment routes.
import QRCode from "qrcode";
import { OWNER_EMAIL_LOWER } from "../owner";
import { resolveRole } from "../roles";
import { rateLimit, clientIp } from "../security";
import type { D1Like } from "../db/types";
import { findInvite, hasAccount } from "./accounts";
import { hashPassword, newTotpSecret, otpauthUri, passwordProblem, safeEqual, sealSecret } from "./crypto";

export class FlowError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function limit(db: D1Like, request: Request, bucket: string, max: number, windowSec: number) {
  if (!(await rateLimit(db, `${bucket}:${clientIp(request)}`, max, windowSec))) {
    throw new FlowError("Too many attempts. Wait a few minutes and try again.", 429);
  }
}

export function setupKeyConfigured(): boolean {
  return (process.env.ADMIN_SETUP_KEY || "").length >= 16;
}

/** Start enrollment for the owner (setup key) or an invited editor (invite token). */
export async function startEnrollment(db: D1Like, body: { mode?: unknown; setupKey?: unknown; token?: unknown; password?: unknown }) {
  let email: string;
  let inviteHash: string | null = null;
  if (body.mode === "setup") {
    if (!setupKeyConfigured()) throw new FlowError("Owner setup is turned off. Add ADMIN_SETUP_KEY (16+ characters) in Vercel to enable it.", 403);
    if (typeof body.setupKey !== "string" || !safeEqual(body.setupKey, process.env.ADMIN_SETUP_KEY!)) throw new FlowError("The setup key is not correct.", 403);
    email = OWNER_EMAIL_LOWER;
  } else if (body.mode === "invite") {
    const inv = await findInvite(db, typeof body.token === "string" ? body.token : null);
    if (!inv) throw new FlowError("This invite link is invalid, used or expired. Ask the owner for a new one.", 403);
    if ((await resolveRole(db, inv.email)) !== "editor") throw new FlowError("This invite was withdrawn.", 403);
    if (await hasAccount(db, inv.email)) throw new FlowError("This editor account already exists. Sign in instead.", 409);
    email = inv.email;
    inviteHash = inv.tokenHash;
  } else {
    throw new FlowError("Unknown enrollment.");
  }
  const password = typeof body.password === "string" ? body.password : "";
  const problem = passwordProblem(password, email);
  if (problem) throw new FlowError(problem);
  const secret = newTotpSecret();
  const uri = otpauthUri(secret, email);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return {
    email,
    pending: { email, passwordHash: await hashPassword(password), secret: await sealSecret(secret), inviteHash },
    display: { email, secret, uri, qrSvg },
  };
}
