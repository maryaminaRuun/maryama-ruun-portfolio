import assert from "node:assert/strict";
import test from "node:test";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
import { base32Encode, base32Decode, hashPassword, openSecret, passwordProblem, sealSecret, signToken, totpAt, verifyPassword, verifyToken, verifyTotp, currentStep, newTotpSecret } from "../lib/auth/crypto";
import { checkPassword, checkSecondFactor, createInvite, createSession, findInvite, markInviteUsed, MAX_FAILED, regenerateRecoveryCodes, remainingRecoveryCodes, revokeSession, saveAccount, SESSION_IDLE_MS, validateSession, changePassword, deleteAccount } from "../lib/auth/accounts";
import { ensureAppSchema } from "../lib/db/schema";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

test("TOTP matches RFC 6238 test vectors (SHA-1)", async () => {
  assert.equal(await totpAt(RFC_SECRET, Math.floor(59 / 30), 8), "94287082");
  assert.equal(await totpAt(RFC_SECRET, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(await totpAt(RFC_SECRET, Math.floor(2000000000 / 30), 8), "69279037");
  assert.deepEqual([...base32Decode(RFC_SECRET)], [...new TextEncoder().encode("12345678901234567890")]);
});

test("TOTP accepts ±1 window, rejects reuse and wrong codes", async () => {
  const s = newTotpSecret();
  const now = Date.now();
  const step = currentStep(now);
  assert.equal(await verifyTotp(s, await totpAt(s, step), 0, now), step);
  assert.equal(await verifyTotp(s, await totpAt(s, step - 1), 0, now), step - 1);
  assert.equal(await verifyTotp(s, await totpAt(s, step), step, now), null, "same code cannot be used twice");
  assert.equal(await verifyTotp(s, await totpAt(s, step - 3), 0, now), null);
  assert.equal(await verifyTotp(s, "abcdef", 0, now), null);
});

test("passwords are salted PBKDF2 and verified correctly", async () => {
  const h = await hashPassword("correct horse battery staple", 1000);
  assert.match(h, /^pbkdf2_sha256\$1000\$/);
  assert.notEqual(h, await hashPassword("correct horse battery staple", 1000), "salted");
  assert.equal(await verifyPassword("correct horse battery staple", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("aaaaaaaaaaaaaaaa"));
  assert.equal(passwordProblem("Mogadishu-Portfolio-2026!"), null);
});

test("TOTP secret is encrypted at rest; signed tokens expire and resist tampering", async () => {
  const sealed = await sealSecret("JBSWY3DPEHPK3PXP");
  assert.ok(!sealed.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(await openSecret(sealed), "JBSWY3DPEHPK3PXP");
  const t = await signToken({ email: "a@b.co" }, 60);
  assert.equal((await verifyToken<{ email: string }>(t))?.email, "a@b.co");
  const [body, sig] = t.split(".");
  assert.equal(await verifyToken(`${body}x.${sig}`), null);
  assert.equal(await verifyToken(await signToken({ email: "a" }, -1)), null);
});

async function dbWithAccount() {
  const db = createSqliteD1();
  await ensureAppSchema(db);
  const secret = newTotpSecret();
  const codes = await saveAccount(db, "Owner@Example.com", await hashPassword("Mogadishu-Portfolio-2026!", 1000), await sealSecret(secret), 0);
  return { db, secret, codes };
}

test("sign-in: password, then authenticator code; lockout after repeated failures", async () => {
  const { db, secret } = await dbWithAccount();
  assert.deepEqual(await checkPassword(db, "owner@example.com", "Mogadishu-Portfolio-2026!"), { ok: true });
  assert.equal((await checkPassword(db, "nobody@example.com", "x")).ok, false);
  const now = Date.now();
  assert.equal((await checkSecondFactor(db, "owner@example.com", await totpAt(secret, currentStep(now)), now)).ok, true);
  assert.equal((await checkSecondFactor(db, "owner@example.com", await totpAt(secret, currentStep(now)), now)).ok, false, "replay blocked");
  for (let i = 0; i < MAX_FAILED; i++) await checkPassword(db, "owner@example.com", "wrong-password-123");
  const locked = await checkPassword(db, "owner@example.com", "Mogadishu-Portfolio-2026!");
  assert.equal(locked.ok, false);
  assert.equal(!locked.ok && locked.reason, "locked");
});

test("recovery codes work once and can be regenerated", async () => {
  const { db, codes } = await dbWithAccount();
  assert.equal(codes.length, 8);
  assert.equal((await checkSecondFactor(db, "owner@example.com", codes[0]!)).usedRecovery, true);
  assert.equal((await checkSecondFactor(db, "owner@example.com", codes[0]!)).ok, false);
  assert.equal(await remainingRecoveryCodes(db, "owner@example.com"), 7);
  const fresh = await regenerateRecoveryCodes(db, "owner@example.com");
  assert.equal((await checkSecondFactor(db, "owner@example.com", codes[1]!)).ok, false, "old codes invalid");
  assert.equal((await checkSecondFactor(db, "owner@example.com", fresh[0]!)).ok, true);
});

test("sessions: valid, idle timeout, revoke, password change signs out other sessions", async () => {
  const { db } = await dbWithAccount();
  const now = Date.now();
  const t = await createSession(db, "owner@example.com", "1.1.1.1", "UA", now);
  assert.equal((await validateSession(db, t, now + 1000))?.email, "owner@example.com");
  assert.equal(await validateSession(db, "forged-token", now), null);
  assert.equal(await validateSession(db, t, now + SESSION_IDLE_MS + 1), null, "idle timeout");
  const a = await createSession(db, "owner@example.com", null, null);
  const b = await createSession(db, "owner@example.com", null, null);
  const keep = (await validateSession(db, a))!.idHash;
  await changePassword(db, "owner@example.com", "Another-Strong-Pass-99", keep);
  assert.ok(await validateSession(db, a));
  assert.equal(await validateSession(db, b), null);
  await revokeSession(db, a);
  assert.equal(await validateSession(db, a), null);
});

test("editor invites are single-use and expire", async () => {
  const { db } = await dbWithAccount();
  const now = Date.now();
  const token = await createInvite(db, "Editor@Example.com", "owner@example.com", now);
  const inv = await findInvite(db, token, now);
  assert.equal(inv?.email, "editor@example.com");
  await markInviteUsed(db, inv!.tokenHash);
  assert.equal(await findInvite(db, token, now), null);
  const t2 = await createInvite(db, "x@example.com", "o", now);
  assert.equal(await findInvite(db, t2, now + 73 * 3600 * 1000), null);
  await deleteAccount(db, "owner@example.com");
});
