import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeClosingMonth } from "../fiscal-year";
import { fromMonthlyWorkReport, fromReport, toMonthlyWorkReport, toReport } from "../storage";
import type { DailyReport, MonthlyWorkReport, WorkUnit } from "../types";
import { generateShareToken, hashShareToken } from "./share-link-token";

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

// トークンはハッシュで照合する（平文トークンの列は参照しないため、旧方式のリンクは使えない）。
export async function findWorkerByToken(supabase: SupabaseClient, token: string): Promise<WorkerSummary | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const link = await supabase.from("worker_share_links").select("worker_id, active, first_used_at").eq("token_hash", hashShareToken(token)).maybeSingle();
  if (link.error) fail("共有リンクの確認", link.error);
  if (!link.data || !link.data.active) return null;
  const worker = await supabase.from("workers").select("*").eq("id", link.data.worker_id).maybeSingle();
  if (worker.error) fail("担当者の確認", worker.error);
  if (!worker.data || !isActive(worker.data)) return null;
  if (!link.data.first_used_at) {
    // 初回利用日時＝外注者がリンクを受け取ったことの確認。記録に失敗しても入力は妨げない。
    const used = await supabase.from("worker_share_links").update({ first_used_at: new Date().toISOString() }).eq("worker_id", link.data.worker_id).is("first_used_at", null);
    if (used.error) console.error("共有リンクの初回利用日時の記録に失敗しました", used.error.message);
  }
  return { id: String(worker.data.id), code: String(worker.data.worker_code ?? worker.data.code ?? ""), name: String(worker.data.name) };
}

export async function issueShareLink(supabase: SupabaseClient, workerId: string) {
  const worker = await supabase.from("workers").select("*").eq("id", workerId).maybeSingle();
  if (worker.error) fail("担当者の確認", worker.error);
  if (!worker.data || !isActive(worker.data)) return null;
  const token = generateShareToken();
  const now = new Date().toISOString();
  const result = await supabase.from("worker_share_links").upsert(
    { worker_id: workerId, token: null, token_hash: hashShareToken(token), active: true, issued_at: now, first_used_at: null, updated_at: now },
    { onConflict: "worker_id" }
  );
  if (result.error) fail("共有リンクの発行", result.error);
  return token;
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

export class ClosedMonthError extends Error {}

// 同じ送信ID（=日報ID）の再送は一意制約で弾かれるので「登録済み」として扱い、二重登録を防ぐ。
// 確定月はDBトリガーでも拒否される（確認と書込みの間に月次確定された場合）。
function insertOutcome(action: string, error: { code?: string; message: string } | null): "inserted" | "duplicate" {
  if (!error) return "inserted";
  if (error.code === "23505") return "duplicate";
  if (error.message.includes("月次確定済み")) throw new ClosedMonthError(error.message);
  fail(action, error);
}

export async function insertSortingReport(supabase: SupabaseClient, record: DailyReport) {
  const result = await supabase.from("daily_reports").insert(fromReport(record));
  return insertOutcome("仕訳日報の保存", result.error);
}

export async function insertMonthlyReport(supabase: SupabaseClient, record: MonthlyWorkReport) {
  const result = await supabase.from("monthly_work_reports").insert(fromMonthlyWorkReport(record));
  return insertOutcome("月次作業日報の保存", result.error);
}
