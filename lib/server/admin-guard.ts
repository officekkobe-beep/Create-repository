export function isAllowedAdminEmail(email: string | null | undefined, allowed: string | null | undefined) {
  if (!email || !allowed) return false;
  const allowList = allowed.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return allowList.includes(email.trim().toLowerCase());
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// CSRF対策: 変更系リクエストは Origin が自サイトのホストと一致するものだけ受け付ける。
export function isSameOrigin(request: { method: string; headers: { get(name: string): string | null } }) {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type CookieOptions = Record<string, unknown> & { maxAge?: number };

export function hardenCookieOptions(options: CookieOptions | undefined, isProduction: boolean): CookieOptions {
  return { ...(options ?? {}), httpOnly: true, sameSite: "strict", secure: isProduction, path: "/" };
}
