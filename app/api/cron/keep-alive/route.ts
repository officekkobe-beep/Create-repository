import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/server/supabase-service";

export const dynamic = "force-dynamic";

// Supabase無料枠の自動停止を防ぐための定期アクセス。公開キーは遮断されるため、サーバー鍵で読む。
// CRON_SECRET を設定している場合、Vercel Cron が付ける Authorization ヘッダーを確認する。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase環境変数が設定されていません" }, { status: 500 });
  }

  const { error } = await supabase.from("clients").select("id").limit(1);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
}
