import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hardenCookieOptions, isAllowedAdminEmail } from "./admin-guard";

export type AdminSession =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export async function createAdminAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === "production";
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value, options }) => cookieStore.set(name, value, hardenCookieOptions(options, isProduction)));
      }
    }
  });
}

export async function requireAdmin(): Promise<AdminSession> {
  if (!process.env.ADMIN_EMAIL) return { ok: false, status: 503, error: "管理者認証が設定されていません。" };
  const supabase = await createAdminAuthClient();
  if (!supabase) return { ok: false, status: 503, error: "認証サービスが設定されていません。" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, status: 401, error: "ログインが必要です。" };
  if (!isAllowedAdminEmail(data.user.email, process.env.ADMIN_EMAIL)) return { ok: false, status: 403, error: "このアカウントには管理権限がありません。" };
  return { ok: true, email: data.user.email ?? "" };
}
