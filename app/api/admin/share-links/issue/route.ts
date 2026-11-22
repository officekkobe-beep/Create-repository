import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/server/admin-guard";
import { forClient, loadAdminData } from "@/lib/server/admin-data";
import { requireAdmin } from "@/lib/server/admin-session";
import { createServiceClient } from "@/lib/server/supabase-service";
import { issueShareLink } from "@/lib/server/work-repository";

export const dynamic = "force-dynamic";

// 新しい共有リンクを発行する（以前のリンクは同時に使えなくなる）。トークンの平文はこの応答でのみ返す。
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "不正なリクエストです。" }, { status: 403 });
  const session = await requireAdmin();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "サーバーの設定が完了していません。" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { workerId?: unknown } | null;
  const workerId = typeof body?.workerId === "string" ? body.workerId : "";
  if (!workerId) return NextResponse.json({ ok: false, error: "担当者を指定してください。" }, { status: 400 });

  try {
    const token = await issueShareLink(supabase, workerId);
    if (!token) return NextResponse.json({ ok: false, error: "有効な担当者が見つかりません。" }, { status: 400 });
    const loaded = await loadAdminData();
    if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
    return NextResponse.json({ ok: true, data: forClient(loaded.data), token });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "共有リンクの発行に失敗しました。" }, { status: 500 });
  }
}
