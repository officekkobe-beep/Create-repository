import { NextResponse } from "next/server";
import { isAllowedAdminEmail, isSameOrigin } from "@/lib/server/admin-guard";
import { createAdminAuthClient } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

const LOGIN_FAILED = "メールアドレスまたはパスワードが正しくありません。";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "不正なリクエストです。" }, { status: 403 });
  if (!process.env.ADMIN_EMAIL) return NextResponse.json({ ok: false, error: "管理者認証が設定されていません。" }, { status: 503 });
  const supabase = await createAdminAuthClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "認証サービスが設定されていません。" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ ok: false, error: "メールアドレスとパスワードを入力してください。" }, { status: 400 });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return NextResponse.json({ ok: false, error: LOGIN_FAILED }, { status: 401 });
  if (!isAllowedAdminEmail(data.user.email, process.env.ADMIN_EMAIL)) {
    await supabase.auth.signOut();
    return NextResponse.json({ ok: false, error: LOGIN_FAILED }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
