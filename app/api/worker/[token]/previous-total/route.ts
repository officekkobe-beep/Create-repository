import { NextResponse } from "next/server";
import { findPreviousReport } from "@/lib/calculations";
import { isValidWorkDate } from "@/lib/server/work-report-rules";
import { createServiceClient } from "@/lib/server/supabase-service";
import { findWorkerByToken, loadSortingReports } from "@/lib/server/work-repository";

export const dynamic = "force-dynamic";

// 前回総仕訳数（同じ顧問先・同じ対象年度の直前の日報）だけを返す。
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "サーバーの設定が完了していません。" }, { status: 503 });
  const { token } = await params;
  const search = new URL(request.url).searchParams;
  const clientId = search.get("clientId") ?? "";
  const workDate = search.get("workDate") ?? "";
  const fiscalYear = Number(search.get("fiscalYear"));
  if (!clientId || !isValidWorkDate(workDate) || !Number.isInteger(fiscalYear)) {
    return NextResponse.json({ ok: false, error: "条件を確認してください。" }, { status: 400 });
  }
  try {
    const worker = await findWorkerByToken(supabase, token);
    if (!worker) return NextResponse.json({ ok: false, error: "このリンクは無効です。管理者に確認してください。" }, { status: 404 });
    const reports = await loadSortingReports(supabase, clientId, fiscalYear);
    const previous = findPreviousReport(reports, { id: "", clientId, workDate, createdAt: new Date().toISOString(), fiscalYear });
    return NextResponse.json({ ok: true, previousTotal: previous?.totalSortingCount ?? 0, isFirst: !previous });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "データの取得に失敗しました。" }, { status: 500 });
  }
}
