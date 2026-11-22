import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeClosingMonth } from "../fiscal-year";
import { fromMonthlyWorkReport, fromReport, toMonthlyWorkReport, toReport } from "../storage";
import type { DailyReport, MonthlyWorkReport, WorkUnit } from "../types";

type Row = Record<string, unknown>;

export type WorkerSummary = { id: string; code: string; name: string };
export type ClientSummary = { id: string; name: string; closingMonth: number };
export type WorkTypeSummary = { id: string; code: string; name: string; unit: WorkUnit };

function isActive(row: Row) {
  return Boolean(row.is_active ?? row.active ?? true);
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action}に失敗しました: ${error.message}`);
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export async function findWorkerByToken(supabase: SupabaseClient, token: string): Promise<WorkerSummary | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const link = await supabase.from("worker_share_links").select("worker_id, active").eq("token", token).maybeSingle();
  if (link.error) fail("共有リンクの確認", link.error);
  if (!link.data || !link.data.active) return null;
  const worker = await supabase.from("workers").select("*").eq("id", link.data.worker_id).maybeSingle();
  if (worker.error) fail("担当者の確認", worker.error);
  if (!worker.data || !isActive(worker.data)) return null;
  return { id: String(worker.data.id), code: String(worker.data.worker_code ?? worker.data.code ?? ""), name: String(worker.data.name) };
}

export async function loadActiveClients(supabase: SupabaseClient): Promise<ClientSummary[]> {
  const result = await supabase.from("clients").select("*").order("name");
  if (result.error) fail("顧問先の取得", result.error);
  return (result.data ?? []).filter(isActive).map((row) => ({ id: String(row.id), name: String(row.name), closingMonth: normalizeClosingMonth(row.closing_month) }));
}

export async function findActiveClient(supabase: SupabaseClient, clientId: string): Promise<ClientSummary | null> {
  const result = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (result.error) fail("顧問先の取得", result.error);
  if (!result.data || !isActive(result.data)) return null;
  return { id: String(result.data.id), name: String(result.data.name), closingMonth: normalizeClosingMonth(result.data.closing_month) };
}

function toWorkTypeSummary(row: Row): WorkTypeSummary {
  return { id: String(row.id), code: String(row.work_type_code ?? row.code ?? ""), name: String(row.name), unit: (row.unit_type ?? row.unit) === "time" ? "time" : "count" };
}

export async function loadActiveWorkTypes(supabase: SupabaseClient): Promise<WorkTypeSummary[]> {
  const result = await supabase.from("work_types").select("*").order("name");
  if (result.error) fail("作業種別の取得", result.error);
  return (result.data ?? []).filter(isActive).map(toWorkTypeSummary);
}

export async function findActiveWorkType(supabase: SupabaseClient, workTypeId: string): Promise<WorkTypeSummary | null> {
  const result = await supabase.from("work_types").select("*").eq("id", workTypeId).maybeSingle();
  if (result.error) fail("作業種別の取得", result.error);
  if (!result.data || !isActive(result.data)) return null;
  return toWorkTypeSummary(result.data);
}

export async function loadClosedMonths(supabase: SupabaseClient): Promise<string[]> {
  const result = await supabase.from("monthly_closings").select("target_month").eq("is_closed", true);
  if (result.error) fail("月次確定状況の取得", result.error);
  return (result.data ?? []).map((row) => String(row.target_month));
}

export async function isMonthClosedInDb(supabase: SupabaseClient, targetMonth: string) {
  const result = await supabase.from("monthly_closings").select("is_closed").eq("target_month", targetMonth).maybeSingle();
  if (result.error) fail("月次確定状況の取得", result.error);
  return Boolean(result.data?.is_closed);
}

export async function loadSortingReports(supabase: SupabaseClient, clientId: string, fiscalYear: number): Promise<DailyReport[]> {
  const result = await supabase.from("daily_reports").select("*").eq("client_id", clientId).eq("fiscal_year", fiscalYear);
  if (result.error) fail("仕訳日報の取得", result.error);
  return (result.data ?? []).map(toReport);
}

export async function loadMonthlyReportsOn(supabase: SupabaseClient, clientId: string, workDate: string): Promise<MonthlyWorkReport[]> {
  const result = await supabase.from("monthly_work_reports").select("*").eq("client_id", clientId).eq("work_date", workDate);
  if (result.error) fail("月次作業日報の取得", result.error);
  return (result.data ?? []).map(toMonthlyWorkReport);
}

export async function loadRecentMonthlyQuantities(supabase: SupabaseClient, clientId: string, workTypeId: string, unit: WorkUnit) {
  const result = await supabase
    .from("monthly_work_reports")
    .select("document_count, work_minutes")
    .eq("client_id", clientId)
    .eq("work_type_id", workTypeId)
    .order("work_date", { ascending: false })
    .limit(20);
  if (result.error) fail("月次作業日報の取得", result.error);
  return (result.data ?? []).map((row) => Number(unit === "count" ? row.document_count : row.work_minutes) || 0);
}

export async function insertSortingReport(supabase: SupabaseClient, record: DailyReport) {
  const result = await supabase.from("daily_reports").insert(fromReport(record));
  if (result.error) fail("仕訳日報の保存", result.error);
}

export async function insertMonthlyReport(supabase: SupabaseClient, record: MonthlyWorkReport) {
  const result = await supabase.from("monthly_work_reports").insert(fromMonthlyWorkReport(record));
  if (result.error) fail("月次作業日報の保存", result.error);
}
