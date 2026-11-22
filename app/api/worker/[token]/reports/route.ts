import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { monthFromDate } from "@/lib/calculations";
import { isSameOrigin } from "@/lib/server/admin-guard";
import { allowRequest } from "@/lib/server/rate-limit";
import { createServiceClient } from "@/lib/server/supabase-service";
import {
  anomalyMessage,
  buildMonthlyRecord,
  buildSortingRecord,
  DUPLICATE_MESSAGE,
  isAllowedFiscalYear,
  isDuplicateMonthly,
  isDuplicateSorting,
  isUnusuallyLarge,
  parseMonthlyInput,
  parseSortingInput,
  previousTotalFor,
  reportIdFor,
  validateMonthlyQuantity,
  validateSortingCounts,
  WORKER_CLOSED_MONTH_MESSAGE
} from "@/lib/server/work-report-rules";
import {
  ClosedMonthError,
  findActiveClient,
  findActiveWorkType,
  findWorkerByToken,
  insertMonthlyReport,
  insertSortingReport,
  isMonthClosedInDb,
  loadMonthlyReportsOn,
  loadRecentMonthlyQuantities,
  loadSortingReports
} from "@/lib/server/work-repository";

export const dynamic = "force-dynamic";

function reject(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function needsConfirmation(warnings: string[]) {
  return reject(409, warnings.join("\n"), { code: "needs_confirmation", needsConfirmation: true, warnings });
}

// 担当者はトークンから決定する（リクエスト本文の担当者IDは使わない）。外注者は新規登録のみで、編集・削除はできない。
// 重複・異常値は拒否せず確認を求め、confirmed: true で再送された場合のみ保存する。
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(request)) return reject(403, "不正なリクエストです。");
  const supabase = createServiceClient();
  if (!supabase) return reject(503, "サーバーの設定が完了していません。");
  const { token } = await params;
  if (!allowRequest(`worker:${token}`, 20, 60_000)) return reject(429, "短時間に送信が続いています。少し待ってから再度お試しください。");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const confirmed = body?.confirmed === true;

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
      if (!confirmed) {
        const warnings: string[] = [];
        if (isDuplicateSorting(reports, worker.id, input)) warnings.push(DUPLICATE_MESSAGE);
        const history = reports.map((report) => report.manualCount + report.smartImportCount);
        if (isUnusuallyLarge(history, input.manualCount + input.smartImportCount)) warnings.push(anomalyMessage("今回作業件数"));
        if (warnings.length) return needsConfirmation(warnings);
      }
      const record = buildSortingRecord({ id: reportIdFor("report", body.requestId, randomUUID), input, workerId: worker.id, clientClosingMonth: client.closingMonth, previousTotal, source: "worker_link", sourceWorkerId: worker.id, now });
      const outcome = await insertSortingReport(supabase, record);
      return NextResponse.json({ ok: true, alreadySaved: outcome === "duplicate", report: record });
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
      if (!confirmed) {
        const warnings: string[] = [];
        const sameDay = await loadMonthlyReportsOn(supabase, input.clientId, input.workDate);
        if (isDuplicateMonthly(sameDay, worker.id, input, workType.unit)) warnings.push(DUPLICATE_MESSAGE);
        const history = await loadRecentMonthlyQuantities(supabase, input.clientId, input.workTypeId, workType.unit);
        const quantity = workType.unit === "count" ? input.documentCount : input.workMinutes;
        if (isUnusuallyLarge(history, quantity)) warnings.push(anomalyMessage(workType.unit === "count" ? "数量" : "作業時間"));
        if (warnings.length) return needsConfirmation(warnings);
      }
      const record = buildMonthlyRecord({ id: reportIdFor("monthly-work", body.requestId, randomUUID), input, workerId: worker.id, unit: workType.unit, source: "worker_link", sourceWorkerId: worker.id, now });
      const outcome = await insertMonthlyReport(supabase, record);
      return NextResponse.json({ ok: true, alreadySaved: outcome === "duplicate", report: record });
    }

    return reject(400, "作業区分を確認してください。");
  } catch (error) {
    if (error instanceof ClosedMonthError) return reject(409, WORKER_CLOSED_MONTH_MESSAGE, { code: "closed_month" });
    console.error(error);
    return reject(500, "保存に失敗しました。時間をおいて再度お試しください。");
  }
}
