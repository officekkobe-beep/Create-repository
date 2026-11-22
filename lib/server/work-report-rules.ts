import { findPreviousReport, monthFromDate } from "../calculations";
import { fiscalStartMonth, fiscalYearFromDate, fiscalYearLabel, normalizeClosingMonth } from "../fiscal-year";
import type { DailyReport, MonthlyWorkReport, ReportSource, WorkUnit } from "../types";

export const WORKER_CLOSED_MONTH_MESSAGE = "この月は月次確定済みのため、作業を登録できません。";
export const SORTING_REGRESSION_MESSAGE = "同じ対象年度内で今回総仕訳数が前回総仕訳数を下回っています。対象年度または総仕訳数を確認してください。";
export const SORTING_MISMATCH_MESSAGE = "今回作業件数と、手入力件数＋スマート取込件数が一致していません。";
export const DUPLICATE_MESSAGE = "同じ内容の作業がすでに登録されています。重複していないか確認してください。";

const MEMO_MAX_LENGTH = 1000;

export type SortingInput = {
  workDate: string;
  clientId: string;
  fiscalYear: number;
  totalSortingCount: number;
  manualCount: number;
  smartImportCount: number;
  memo: string;
};

export type MonthlyInput = {
  workDate: string;
  clientId: string;
  workTypeId: string;
  documentCount: number;
  workMinutes: number;
  memo: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidWorkDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function parseSortingInput(body: unknown): Parsed<SortingInput> {
  if (!isRecord(body)) return { ok: false, error: "入力内容を確認してください。" };
  if (!isValidWorkDate(body.workDate)) return { ok: false, error: "作業日を確認してください。" };
  if (!text(body.clientId)) return { ok: false, error: "顧問先を選択してください。" };
  if (!Number.isInteger(body.fiscalYear)) return { ok: false, error: "対象年度を選択してください。" };
  for (const key of ["totalSortingCount", "manualCount", "smartImportCount"] as const) {
    if (!nonNegativeInteger(body[key])) return { ok: false, error: "件数は0以上の整数で入力してください。" };
  }
  const memo = text(body.memo).trim();
  if (memo.length > MEMO_MAX_LENGTH) return { ok: false, error: "メモが長すぎます。" };
  return {
    ok: true,
    value: {
      workDate: body.workDate,
      clientId: text(body.clientId),
      fiscalYear: body.fiscalYear as number,
      totalSortingCount: body.totalSortingCount as number,
      manualCount: body.manualCount as number,
      smartImportCount: body.smartImportCount as number,
      memo
    }
  };
}

export function parseMonthlyInput(body: unknown): Parsed<MonthlyInput> {
  if (!isRecord(body)) return { ok: false, error: "入力内容を確認してください。" };
  if (!isValidWorkDate(body.workDate)) return { ok: false, error: "作業日を確認してください。" };
  if (!text(body.clientId)) return { ok: false, error: "顧問先を選択してください。" };
  if (!text(body.workTypeId)) return { ok: false, error: "作業種別を選択してください。" };
  for (const key of ["documentCount", "workMinutes"] as const) {
    if (!nonNegativeInteger(body[key])) return { ok: false, error: "数量・作業時間は0以上の整数で入力してください。" };
  }
  const memo = text(body.memo).trim();
  if (memo.length > MEMO_MAX_LENGTH) return { ok: false, error: "メモが長すぎます。" };
  return {
    ok: true,
    value: {
      workDate: body.workDate,
      clientId: text(body.clientId),
      workTypeId: text(body.workTypeId),
      documentCount: body.documentCount as number,
      workMinutes: body.workMinutes as number,
      memo
    }
  };
}

// 対象年度は作業日から自動判定した年度の前後1年まで（既存画面の選択肢と同じ範囲）。
export function isAllowedFiscalYear(fiscalYear: number, workDate: string, closingMonth: number) {
  return Math.abs(fiscalYear - fiscalYearFromDate(workDate, closingMonth)) <= 1;
}

export function validateSortingCounts(input: SortingInput, previousTotal: number) {
  if (input.totalSortingCount < previousTotal) return SORTING_REGRESSION_MESSAGE;
  if (input.totalSortingCount - previousTotal !== input.manualCount + input.smartImportCount) return SORTING_MISMATCH_MESSAGE;
  return null;
}

export function validateMonthlyQuantity(input: MonthlyInput, unit: WorkUnit) {
  if (unit === "count" && input.documentCount <= 0) return "数量を入力してください。";
  if (unit === "time" && input.workMinutes <= 0) return "作業時間（分）を入力してください。";
  return null;
}

export function previousTotalFor(reports: DailyReport[], input: Pick<SortingInput, "clientId" | "workDate" | "fiscalYear">, createdAt: string, excludeId = "") {
  return findPreviousReport(reports, { id: excludeId, clientId: input.clientId, workDate: input.workDate, createdAt, fiscalYear: input.fiscalYear })?.totalSortingCount ?? 0;
}

export function isDuplicateSorting(existing: DailyReport[], workerId: string, input: SortingInput, excludeId = "") {
  return existing.some(
    (report) =>
      report.id !== excludeId &&
      report.workerId === workerId &&
      report.clientId === input.clientId &&
      report.workDate === input.workDate &&
      report.fiscalYear === input.fiscalYear &&
      report.totalSortingCount === input.totalSortingCount
  );
}

export function isDuplicateMonthly(existing: MonthlyWorkReport[], workerId: string, input: MonthlyInput, unit: WorkUnit, excludeId = "") {
  return existing.some(
    (report) =>
      report.id !== excludeId &&
      report.workerId === workerId &&
      report.clientId === input.clientId &&
      report.workTypeId === input.workTypeId &&
      report.workDate === input.workDate &&
      (unit === "count" ? report.documentCount === input.documentCount : report.workMinutes === input.workMinutes)
  );
}

export function buildSortingRecord(params: {
  id: string;
  input: SortingInput;
  workerId: string;
  clientClosingMonth: number;
  previousTotal: number;
  source: ReportSource;
  sourceWorkerId: string;
  now: string;
  createdAt?: string;
}): DailyReport {
  const { input } = params;
  const closingMonth = normalizeClosingMonth(params.clientClosingMonth);
  return {
    id: params.id,
    workDate: input.workDate,
    workMonth: monthFromDate(input.workDate),
    workerId: params.workerId,
    clientId: input.clientId,
    manualCount: input.manualCount,
    smartImportCount: input.smartImportCount,
    totalSortingCount: input.totalSortingCount,
    memo: input.memo,
    source: params.source,
    sourceWorkerId: params.sourceWorkerId,
    fiscalYear: input.fiscalYear,
    fiscalYearLabel: fiscalYearLabel(input.fiscalYear),
    clientClosingMonth: closingMonth,
    clientFiscalStartMonth: fiscalStartMonth(closingMonth),
    previousTotalJournalCount: params.previousTotal,
    currentTotalJournalCount: input.totalSortingCount,
    createdAt: params.createdAt ?? params.now,
    updatedAt: params.now
  };
}

export function buildMonthlyRecord(params: {
  id: string;
  input: MonthlyInput;
  workerId: string;
  unit: WorkUnit;
  source: ReportSource;
  sourceWorkerId: string;
  now: string;
  createdAt?: string;
}): MonthlyWorkReport {
  const { input } = params;
  return {
    id: params.id,
    workDate: input.workDate,
    workMonth: monthFromDate(input.workDate),
    workerId: params.workerId,
    workTypeId: input.workTypeId,
    clientId: input.clientId,
    documentCount: params.unit === "count" ? input.documentCount : 0,
    workMinutes: params.unit === "time" ? input.workMinutes : 0,
    memo: input.memo,
    source: params.source,
    sourceWorkerId: params.sourceWorkerId,
    createdAt: params.createdAt ?? params.now,
    updatedAt: params.now
  };
}
