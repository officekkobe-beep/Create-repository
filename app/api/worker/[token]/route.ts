import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/server/supabase-service";
import { findWorkerByToken, loadActiveClients, loadActiveWorkTypes, loadClosedMonths } from "@/lib/server/work-repository";

export const dynamic = "force-dynamic";

// 外注者に返すのは入力に必要な最小限の情報のみ（単価・外注費・他担当者・監査ログは返さない）。
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "サーバーの設定が完了していません。" }, { status: 503 });
  const { token } = await params;
  try {
    const worker = await findWorkerByToken(supabase, token);
    if (!worker) return NextResponse.json({ ok: false, error: "このリンクは無効です。管理者に確認してください。" }, { status: 404 });
    const [clients, workTypes, closedMonths] = await Promise.all([loadActiveClients(supabase), loadActiveWorkTypes(supabase), loadClosedMonths(supabase)]);
    return NextResponse.json({ ok: true, worker, clients, workTypes, closedMonths });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "データの取得に失敗しました。" }, { status: 500 });
  }
}
