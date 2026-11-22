import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/server/admin-guard";
import { createServiceClient } from "@/lib/server/supabase-service";
import {
  buildMonthlyRecord,
  buildSortingRecord,
  DUPLICATE_MESSAGE,
  isAllowedFiscalYear,
  isDuplicateMonthly,
  isDuplicateSorting,
  parseMonthlyInput,
  parseSortingInput,
  previousTotalFor,
  validateMonthlyQuantity,
  validateSortingCounts,
  WORKER_CLOSED_MONTH_MESSAGE
} from "@/lib/server/work-report-rules";
import {
  findActiveClient,
  findActiveWorkType,
  findWorkerByToken,
  insertMonthlyReport,
  insertSortingReport,
  isMonthClosedInDb,
  loadMonthlyReportsOn,
  loadSortingReports
} from "@/lib/server/work-repository";
import { monthFromDate } from "@/lib/calculations";

export const dynamic = "force-dynamic";

function reject(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

// 担当者はトークンから決定する（リクエスト本文の担当者IDは使わない）。外注者は新規登録のみで、編集・削除はできない。
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(request)) return reject(403, "不正なリクエストです。");
  const supabase = createServiceClient();
  if (!supabase) return reject(503, "サーバーの設定が完了していません。");
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const confirmDuplicate = body?.confirmDuplicate === true;

  try {
    const worker = await findWorkerByToken(supabase, token);
    if (!worker) return reject(404, "このリンクは無効です。管理者に確認してください。");
    const now = new Date().toISOString();

    if (body?.kind === "sorting") {
      const parsed = parseSortingInput(body);
      if (!parsed.ok) return reject(400, parsed.error);
      const input = parsed.value;
      const client = await findActiveClient(supabase, input.clientId);
      if (!client) return reject(400, "顧問先を選択してください。");
      if (!isAllowedFiscalYear(input.fiscalYear, input.workDate, client.closingMonth)) return reject(400, "対象年度を確認してください。");
      if (await isMonthClosedInDb(supabase, monthFromDate(input.workDate))) return reject(409, WORKER_CLOSED_MONTH_MESSAGE, { code: "closed_month" });
      const reports = await loadSortingReports(supabase, input.clientId, input.fiscalYear);
      const previousTotal = previousTotalFor(reports, input, now);
      const countError = validateSortingCounts(input, previousTotal);
      if (countError) return reject(400, countError);
      if (!confirmDuplicate && isDuplicateSorting(reports, worker.id, input)) return reject(409, DUPLICATE_MESSAGE, { code: "duplicate", needsConfirmation: true });
      const record = buildSortingRecord({ id: `report-${randomUUID()}`, input, workerId: worker.id, clientClosingMonth: client.closingMonth, previousTotal, source: "worker_link", sourceWorkerId: worker.id, now });
      await insertSortingReport(supabase, record);
      return NextResponse.json({ ok: true, report: record });
    }

    if (body?.kind === "monthly") {
      const parsed = parseMonthlyInput(body);
      if (!parsed.ok) return reject(400, parsed.error);
      const input = parsed.value;
      const [client, workType] = await Promise.all([findActiveClient(supabase, input.clientId), findActiveWorkType(supabase, input.workTypeId)]);
      if (!client) return reject(400, "顧問先を選択してください。");
      if (!workType) return reject(400, "作業種別を選択してください。");
      const quantityError = validateMonthlyQuantity(input, workType.unit);
      if (quantityError) return reject(400, quantityError);
      if (await isMonthClosedInDb(supabase, monthFromDate(input.workDate))) return reject(409, WORKER_CLOSED_MONTH_MESSAGE, { code: "closed_month" });
      const sameDay = await loadMonthlyReportsOn(supabase, input.clientId, input.workDate);
      if (!confirmDuplicate && isDuplicateMonthly(sameDay, worker.id, input, workType.unit)) return reject(409, DUPLICATE_MESSAGE, { code: "duplicate", needsConfirmation: true });
      const record = buildMonthlyRecord({ id: `monthly-work-${randomUUID()}`, input, workerId: worker.id, unit: workType.unit, source: "worker_link", sourceWorkerId: worker.id, now });
      await insertMonthlyReport(supabase, record);
      return NextResponse.json({ ok: true, report: record });
    }

    return reject(400, "作業区分を確認してください。");
  } catch (error) {
    console.error(error);
    return reject(500, "保存に失敗しました。時間をおいて再度お試しください。");
  }
}
