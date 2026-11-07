// Cryptographic building blocks for admin sign-in, using only the platform's
// Web Crypto API (no third-party crypto code).

const enc = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

// ---- Passwords: PBKDF2-SHA256 ----
export const PBKDF2_ITERATIONS = 310_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256));
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  return `pbkdf2_sha256$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2_sha256" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(got), hash);
}

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (email && password.toLowerCase().includes(email.split("@")[0]!.toLowerCase())) return "Don't include your email name in the password.";
  if (new Set(password).size < 6) return "Use a less repetitive password.";
  return null;
}

// ---- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export async function totpAt(secretB32: string, step: number, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new Uint8Array(8);
  let c = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const off = mac[mac.length - 1]! & 15;
  const code = (((mac[off]! & 127) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / 30);

/**
 * Checks a code against the previous, current and next 30-second window.
 * Returns the matching step (so callers can block reuse), or null.
 */
export async function verifyTotp(secretB32: string, code: string, lastUsedStep: number, now = Date.now()): Promise<number | null> {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastUsedStep) continue;
    if (safeEqual(await totpAt(secretB32, s), c)) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, email: string, issuer = "Maryama Ruun Portfolio"): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---- Secrets derived from AUTH_SECRET ----
export class AuthConfigError extends Error {
  constructor() {
    super("Admin sign-in is not configured: set AUTH_SECRET (at least 32 random characters) in the Vercel environment variables.");
  }
}

export function authSecret(): string {
  const s = process.env.AUTH_SECRET || "";
  if (s.length < 32) throw new AuthConfigError();
  return s;
}

async function hkdfKey(purpose: string, usage: "AES-GCM" | "HMAC"): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(authSecret()), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("maryama-portfolio-v1"), info: enc.encode(purpose) },
    base,
    usage === "AES-GCM" ? { name: "AES-GCM", length: 256 } : { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    usage === "AES-GCM" ? ["encrypt", "decrypt"] : ["sign", "verify"],
  );
}

/** Encrypt the TOTP secret at rest (AES-256-GCM). */
export async function sealSecret(plain: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await hkdfKey("totp-secret", "AES-GCM"), enc.encode(plain)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function openSecret(sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unknown secret format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) as BufferSource }, await hkdfKey("totp-secret", "AES-GCM"), fromB64url(ct) as BufferSource);
  return new TextDecoder().decode(pt);
}

/** Short-lived signed token (used between the password step and the MFA step). */
export async function signToken(payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hkdfKey("signed-token", "HMAC"), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken<T extends Record<string, unknown>>(token: string | undefined | null): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hkdfKey("signed-token", "HMAC"), fromB64url(sig) as BufferSource, enc.encode(body));
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T & { exp: number };
  return data.exp > Date.now() / 1000 ? data : null;
}

export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(6)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
