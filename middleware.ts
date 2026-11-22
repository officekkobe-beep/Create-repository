import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hardenCookieOptions, isAllowedAdminEmail } from "@/lib/server/admin-guard";

// 管理者セッション（Supabase Authのトークン）を更新し、未ログインで管理画面を開いた場合はログイン画面へ移動する。
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !anonKey) return response;

  const isProduction = process.env.NODE_ENV === "production";
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, hardenCookieOptions(options, isProduction)));
      }
    }
  });
  const { data } = await supabase.auth.getUser();

  if (request.nextUrl.pathname === "/" && !isAllowedAdminEmail(data.user?.email, process.env.ADMIN_EMAIL)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = { matcher: ["/", "/api/admin/:path*"] };
