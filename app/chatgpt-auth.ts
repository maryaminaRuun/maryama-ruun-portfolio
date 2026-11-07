import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

/**
 * The identity headers are injected by ChatGPT Sites hosting. On any other host
 * (e.g. a plain Cloudflare Workers staging copy) a visitor could send them
 * themselves, so they are only trusted on *.chatgpt.site, localhost, or hosts
 * listed in the ADMIN_TRUSTED_HOSTS environment variable (comma-separated).
 */
export async function isPlatformAuthTrusted(host: string | null): Promise<boolean> {
  const h = (host || "").toLowerCase().split(":")[0]!;
  if (!h) return false;
  if (h.endsWith(".chatgpt.site") || h === "localhost" || h === "127.0.0.1") return true;
  try {
    const { env } = await import("cloudflare:workers");
    const extra = String((env as Record<string, unknown>).ADMIN_TRUSTED_HOSTS || "");
    return extra.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(h);
  } catch {
    return false;
  }
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  if (!(await isPlatformAuthTrusted(requestHeaders.get("host")))) return null;
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
