import { NextResponse } from "next/server";
import { AdminError } from "./admin-content";
import { noStore } from "./admin";
import { MediaError } from "./media";
import { UpgradeError } from "./db/upgrade";
import { ImportError } from "./db/import";
import { DatabaseNotConfiguredError } from "./db/types";
import { AuthConfigError } from "./auth/crypto";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStore });
}

/** Turn known errors into clear JSON responses; hide internals for anything else. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AdminError || e instanceof MediaError) return json({ error: e.message }, e.status);
    if (e instanceof UpgradeError) return json({ error: e.message, code: e.code }, 409);
    if (e instanceof ImportError) return json({ error: e.message }, 400);
    if (e instanceof DatabaseNotConfiguredError || e instanceof AuthConfigError) return json({ error: e.message, code: "not_configured" }, 503);
    console.error("admin api error", e);
    return json({ error: "Something went wrong. Nothing was changed." }, 500);
  }
}

export function idFrom(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AdminError("Invalid id.");
  return id;
}
