import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { monthFromDate } from "./calculations";
import { defaultPaymentStatementSettings, defaultSortingUnitPrices, defaultUnitPrices, defaultWorkerOutsourcePrices, defaultWorkTypes, sampleData } from "./sample-data";
import type { AppData, Client, DailyReport, MonthlyWorkReport, MonthlyWorkReportInput, PaymentStatementSettings, ReportInput, SortingUnitPrice, UnitPrice, Worker, WorkerOutsourcePrice, WorkerShareLink } from "./types";

const STORAGE_KEY = "sorting-daily-report-data";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createToken() {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

function supabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

function withDefaults(data: Partial<AppData>): AppData {
  const unitPrices = data.unitPrices ?? [];
  const sortingUnitPrices = data.sortingUnitPrices ?? [];
  const workers = data.workers ?? sampleData.workers;
  const workerOutsourcePrices = data.workerOutsourcePrices ?? [];
  return {
    workers,
    clients: data.clients ?? sampleData.clients,
    workTypes: data.workTypes ?? defaultWorkTypes,
    unitPrices: defaultUnitPrices.map((price) => ({ ...price, ...(unitPrices.find((item) => item.workTypeId === price.workTypeId) ?? {}) })),
    sortingUnitPrices: defaultSortingUnitPrices.map((price) => ({ ...price, ...(sortingUnitPrices.find((item) => item.id === price.id) ?? {}) })),
    workerOutsourcePrices: defaultWorkerOutsourcePrices(workers).map((price) => ({ ...price, ...(workerOutsourcePrices.find((item) => item.workerId === price.workerId) ?? {}) })),
    workerShareLinks: data.workerShareLinks ?? [],
    paymentStatementSettings: { ...defaultPaymentStatementSettings, ...(data.paymentStatementSettings ?? {}) },
    reports: (data.reports ?? []).map((report) => ({ ...report, source: report.source ?? "admin", sourceWorkerId: report.sourceWorkerId ?? "" })),
    monthlyWorkReports: (data.monthlyWorkReports ?? []).map((report) => ({ ...report, workerId: report.workerId ?? workers[0]?.id ?? "", source: report.source ?? "admin", sourceWorkerId: report.sourceWorkerId ?? "" }))
  };
}

function loadLocal(): AppData {
  if (typeof window === "undefined") return sampleData;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleData));
    return sampleData;
  }
  const data = withDefaults(JSON.parse(raw) as Partial<AppData>);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function saveLocal(data: AppData) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function toReport(row: Record<string, unknown>): DailyReport {
  return {
    id: String(row.id),
    workDate: String(row.work_date),
    workMonth: String(row.work_month),
    workerId: String(row.worker_id),
    clientId: String(row.client_id),
    manualCount: Number(row.manual_count ?? 0),
    smartImportCount: Number(row.smart_import_count ?? 0),
    totalSortingCount: Number(row.total_sorting_count ?? 0),
    memo: String(row.memo ?? ""),
    source: row.source === "worker_link" ? "worker_link" : "admin",
    sourceWorkerId: String(row.source_worker_id ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function fromReport(input: DailyReport) {
  return {
    id: input.id,
    work_date: input.workDate,
    work_month: input.workMonth,
    worker_id: input.workerId,
    client_id: input.clientId,
    manual_count: input.manualCount,
    smart_import_count: input.smartImportCount,
    total_sorting_count: input.totalSortingCount,
    memo: input.memo,
    source: input.source,
    source_worker_id: input.sourceWorkerId,
    created_at: input.createdAt,
    updated_at: input.updatedAt
  };
}

function toMonthlyWorkReport(row: Record<string, unknown>): MonthlyWorkReport {
  return {
    id: String(row.id),
    workDate: String(row.work_date),
    workMonth: String(row.work_month),
    workerId: String(row.worker_id ?? ""),
    workTypeId: row.work_type_id as MonthlyWorkReport["workTypeId"],
    clientId: String(row.client_id),
    documentCount: Number(row.document_count ?? 0),
    workMinutes: Number(row.work_minutes ?? 0),
    memo: String(row.memo ?? ""),
    source: row.source === "worker_link" ? "worker_link" : "admin",
    sourceWorkerId: String(row.source_worker_id ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function fromMonthlyWorkReport(input: MonthlyWorkReport) {
  return {
    id: input.id,
    work_date: input.workDate,
    work_month: input.workMonth,
    worker_id: input.workerId,
    work_type_id: input.workTypeId,
    client_id: input.clientId,
    document_count: input.documentCount,
    work_minutes: input.workMinutes,
    memo: input.memo,
    source: input.source,
    source_worker_id: input.sourceWorkerId,
    created_at: input.createdAt,
    updated_at: input.updatedAt
  };
}

export async function fetchData(): Promise<{ data: AppData; mode: "supabase" | "local" }> {
  const supabase = supabaseClient();
  if (!supabase) return { data: loadLocal(), mode: "local" };

  const [workersResult, clientsResult, reportsResult, workTypesResult, unitPricesResult, sortingUnitPricesResult, workerOutsourcePricesResult, workerShareLinksResult, paymentStatementSettingsResult, monthlyWorkReportsResult] = await Promise.all([
    supabase.from("workers").select("*").order("name"),
    supabase.from("clients").select("*").order("name"),
    supabase.from("daily_reports").select("*").order("work_date", { ascending: false }),
    supabase.from("work_types").select("*").order("name"),
    supabase.from("unit_prices").select("*").order("work_type_id"),
    supabase.from("sorting_unit_prices").select("*").order("id"),
    supabase.from("worker_outsource_prices").select("*").order("worker_id"),
    supabase.from("worker_share_links").select("*").order("worker_id"),
    supabase.from("payment_statement_settings").select("*").eq("id", "default").maybeSingle(),
    supabase.from("monthly_work_reports").select("*").order("work_date", { ascending: false })
  ]);

  if (workersResult.error || clientsResult.error || reportsResult.error || workTypesResult.error || unitPricesResult.error || sortingUnitPricesResult.error || workerOutsourcePricesResult.error || workerShareLinksResult.error || paymentStatementSettingsResult.error || monthlyWorkReportsResult.error) {
    console.warn(
      "Supabase fetch failed. Falling back to local data.",
      workersResult.error ?? clientsResult.error ?? reportsResult.error ?? workTypesResult.error ?? unitPricesResult.error ?? sortingUnitPricesResult.error ?? workerOutsourcePricesResult.error ?? workerShareLinksResult.error ?? paymentStatementSettingsResult.error ?? monthlyWorkReportsResult.error
    );
    return { data: loadLocal(), mode: "local" };
  }

  return {
    mode: "supabase",
    data: withDefaults({
      workers: (workersResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
        createdAt: row.created_at
      })),
      clients: (clientsResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        active: row.active,
        createdAt: row.created_at
      })),
      reports: (reportsResult.data ?? []).map(toReport),
      workTypes: (workTypesResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        unit: row.unit,
        active: row.active,
        createdAt: row.created_at
      })),
      unitPrices: (unitPricesResult.data ?? []).map((row) => ({
        workTypeId: row.work_type_id,
        amount: row.amount,
        costAmount: row.cost_amount ?? 0,
        quantity: row.quantity,
        unitLabel: row.unit_label,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      sortingUnitPrices: (sortingUnitPricesResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        amount: row.amount,
        costAmount: row.cost_amount ?? 0,
        quantity: row.quantity,
        unitLabel: row.unit_label,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      workerOutsourcePrices: (workerOutsourcePricesResult.data ?? []).map((row) => ({
        workerId: row.worker_id,
        manualUnitPrice: row.manual_unit_price,
        smartUnitPrice: row.smart_unit_price,
        submittedDocumentsUnitPrice: row.submitted_documents_unit_price,
        officeWorkUnitPrice: row.office_work_unit_price,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      workerShareLinks: (workerShareLinksResult.data ?? []).map((row) => ({
        workerId: row.worker_id,
        token: row.token,
        active: row.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      paymentStatementSettings: paymentStatementSettingsResult.data
        ? {
            title: paymentStatementSettingsResult.data.title,
            issuerName: paymentStatementSettingsResult.data.issuer_name,
            issuerAddress: paymentStatementSettingsResult.data.issuer_address,
            issuerPhone: paymentStatementSettingsResult.data.issuer_phone,
            issuerEmail: paymentStatementSettingsResult.data.issuer_email,
            registrationNumber: paymentStatementSettingsResult.data.registration_number,
            paymentDueText: paymentStatementSettingsResult.data.payment_due_text,
            bankFeeText: paymentStatementSettingsResult.data.bank_fee_text,
            notes: paymentStatementSettingsResult.data.notes,
            footerText: paymentStatementSettingsResult.data.footer_text,
            updatedAt: paymentStatementSettingsResult.data.updated_at
          }
        : defaultPaymentStatementSettings,
      monthlyWorkReports: (monthlyWorkReportsResult.data ?? []).map(toMonthlyWorkReport)
    })
  };
}

export async function upsertWorker(worker: Partial<Worker> & Pick<Worker, "name">, current: AppData) {
  const supabase = supabaseClient();
  const record: Worker = {
    id: worker.id ?? createId("worker"),
    name: worker.name.trim(),
    active: worker.active ?? true,
    createdAt: worker.createdAt ?? nowIso()
  };
  const next = { ...current, workers: [...current.workers.filter((item) => item.id !== record.id), record] };
  if (!next.workerOutsourcePrices.some((item) => item.workerId === record.id)) {
    next.workerOutsourcePrices = [
      ...next.workerOutsourcePrices,
      {
        workerId: record.id,
        manualUnitPrice: 40,
        smartUnitPrice: 20,
        submittedDocumentsUnitPrice: 1000,
        officeWorkUnitPrice: 300,
        createdAt: record.createdAt,
        updatedAt: record.createdAt
      }
    ];
  }
  if (supabase) {
    await supabase.from("workers").upsert({ id: record.id, name: record.name, active: record.active, created_at: record.createdAt });
    await supabase.from("worker_outsource_prices").upsert({
      worker_id: record.id,
      manual_unit_price: next.workerOutsourcePrices.find((item) => item.workerId === record.id)?.manualUnitPrice ?? 40,
      smart_unit_price: next.workerOutsourcePrices.find((item) => item.workerId === record.id)?.smartUnitPrice ?? 20,
      submitted_documents_unit_price: next.workerOutsourcePrices.find((item) => item.workerId === record.id)?.submittedDocumentsUnitPrice ?? 1000,
      office_work_unit_price: next.workerOutsourcePrices.find((item) => item.workerId === record.id)?.officeWorkUnitPrice ?? 300,
      created_at: record.createdAt,
      updated_at: record.createdAt
    });
  }
  saveLocal(next);
  return next;
}

export async function deleteWorker(id: string, current: AppData) {
  const supabase = supabaseClient();
  const next = { ...current, workers: current.workers.filter((item) => item.id !== id), workerShareLinks: current.workerShareLinks.filter((item) => item.workerId !== id) };
  if (supabase) await supabase.from("workers").delete().eq("id", id);
  saveLocal(next);
  return next;
}

export async function issueWorkerShareLink(workerId: string, current: AppData) {
  const supabase = supabaseClient();
  const existing = current.workerShareLinks.find((item) => item.workerId === workerId);
  const record: WorkerShareLink = {
    workerId,
    token: existing?.token ?? createToken(),
    active: true,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
  const next = { ...current, workerShareLinks: [...current.workerShareLinks.filter((item) => item.workerId !== workerId), record] };
  if (supabase) {
    await supabase.from("worker_share_links").upsert({
      worker_id: record.workerId,
      token: record.token,
      active: record.active,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });
  }
  saveLocal(next);
  return next;
}

export async function toggleWorkerShareLink(workerId: string, active: boolean, current: AppData) {
  const existing = current.workerShareLinks.find((item) => item.workerId === workerId);
  if (!existing) return issueWorkerShareLink(workerId, current);
  const supabase = supabaseClient();
  const record = { ...existing, active, updatedAt: nowIso() };
  const next = { ...current, workerShareLinks: [...current.workerShareLinks.filter((item) => item.workerId !== workerId), record] };
  if (supabase) {
    await supabase.from("worker_share_links").upsert({
      worker_id: record.workerId,
      token: record.token,
      active: record.active,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });
  }
  saveLocal(next);
  return next;
}

export async function upsertClient(client: Partial<Client> & Pick<Client, "name">, current: AppData) {
  const supabase = supabaseClient();
  const record: Client = {
    id: client.id ?? createId("client"),
    name: client.name.trim(),
    code: client.code?.trim() ?? "",
    active: client.active ?? true,
    createdAt: client.createdAt ?? nowIso()
  };
  const next = { ...current, clients: [...current.clients.filter((item) => item.id !== record.id), record] };
  if (supabase) await supabase.from("clients").upsert({ id: record.id, name: record.name, code: record.code, active: record.active, created_at: record.createdAt });
  saveLocal(next);
  return next;
}

export async function deleteClient(id: string, current: AppData) {
  const supabase = supabaseClient();
  const next = { ...current, clients: current.clients.filter((item) => item.id !== id) };
  if (supabase) await supabase.from("clients").delete().eq("id", id);
  saveLocal(next);
  return next;
}

export async function upsertReport(input: Partial<DailyReport> & ReportInput, current: AppData) {
  const supabase = supabaseClient();
  const existing = input.id ? current.reports.find((report) => report.id === input.id) : undefined;
  const record: DailyReport = {
    id: input.id ?? createId("report"),
    workDate: input.workDate,
    workMonth: monthFromDate(input.workDate),
    workerId: input.workerId,
    clientId: input.clientId,
    manualCount: Number(input.manualCount),
    smartImportCount: Number(input.smartImportCount),
    totalSortingCount: Number(input.totalSortingCount),
    memo: input.memo.trim(),
    source: input.source ?? existing?.source ?? "admin",
    sourceWorkerId: input.sourceWorkerId ?? existing?.sourceWorkerId ?? "",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
  const next = {
    ...current,
    reports: [...current.reports.filter((item) => item.id !== record.id), record].sort((a, b) => b.workDate.localeCompare(a.workDate))
  };
  if (supabase) await supabase.from("daily_reports").upsert(fromReport(record));
  saveLocal(next);
  return next;
}

export async function deleteReport(id: string, current: AppData) {
  const supabase = supabaseClient();
  const next = { ...current, reports: current.reports.filter((item) => item.id !== id) };
  if (supabase) await supabase.from("daily_reports").delete().eq("id", id);
  saveLocal(next);
  return next;
}

export async function upsertMonthlyWorkReport(input: Partial<MonthlyWorkReport> & MonthlyWorkReportInput, current: AppData) {
  const supabase = supabaseClient();
  const existing = input.id ? current.monthlyWorkReports.find((report) => report.id === input.id) : undefined;
  const record: MonthlyWorkReport = {
    id: input.id ?? createId("monthly-work"),
    workDate: input.workDate,
    workMonth: monthFromDate(input.workDate),
    workerId: input.workerId,
    workTypeId: input.workTypeId,
    clientId: input.clientId,
    documentCount: Number(input.documentCount),
    workMinutes: Number(input.workMinutes),
    memo: input.memo.trim(),
    source: input.source ?? existing?.source ?? "admin",
    sourceWorkerId: input.sourceWorkerId ?? existing?.sourceWorkerId ?? "",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
  const next = {
    ...current,
    monthlyWorkReports: [...current.monthlyWorkReports.filter((item) => item.id !== record.id), record].sort((a, b) => b.workDate.localeCompare(a.workDate))
  };
  if (supabase) await supabase.from("monthly_work_reports").upsert(fromMonthlyWorkReport(record));
  saveLocal(next);
  return next;
}

export async function deleteMonthlyWorkReport(id: string, current: AppData) {
  const supabase = supabaseClient();
  const next = { ...current, monthlyWorkReports: current.monthlyWorkReports.filter((item) => item.id !== id) };
  if (supabase) await supabase.from("monthly_work_reports").delete().eq("id", id);
  saveLocal(next);
  return next;
}

export async function updateUnitPrice(price: UnitPrice, current: AppData) {
  const supabase = supabaseClient();
  const record = { ...price, updatedAt: nowIso() };
  const next = { ...current, unitPrices: current.unitPrices.map((item) => (item.workTypeId === record.workTypeId ? record : item)) };
  if (supabase) {
    await supabase.from("unit_prices").upsert({
      work_type_id: record.workTypeId,
      amount: record.amount,
      cost_amount: record.costAmount,
      quantity: record.quantity,
      unit_label: record.unitLabel,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });
  }
  saveLocal(next);
  return next;
}

export async function updateSortingUnitPrice(price: SortingUnitPrice, current: AppData) {
  const supabase = supabaseClient();
  const record = { ...price, updatedAt: nowIso() };
  const next = { ...current, sortingUnitPrices: current.sortingUnitPrices.map((item) => (item.id === record.id ? record : item)) };
  if (supabase) {
    await supabase.from("sorting_unit_prices").upsert({
      id: record.id,
      name: record.name,
      amount: record.amount,
      cost_amount: record.costAmount,
      quantity: record.quantity,
      unit_label: record.unitLabel,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });
  }
  saveLocal(next);
  return next;
}

export async function updateWorkerOutsourcePrice(price: WorkerOutsourcePrice, current: AppData) {
  const supabase = supabaseClient();
  const record = { ...price, updatedAt: nowIso() };
  const next = {
    ...current,
    workerOutsourcePrices: current.workerOutsourcePrices.map((item) => (item.workerId === record.workerId ? record : item))
  };
  if (supabase) {
    await supabase.from("worker_outsource_prices").upsert({
      worker_id: record.workerId,
      manual_unit_price: record.manualUnitPrice,
      smart_unit_price: record.smartUnitPrice,
      submitted_documents_unit_price: record.submittedDocumentsUnitPrice,
      office_work_unit_price: record.officeWorkUnitPrice,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });
  }
  saveLocal(next);
  return next;
}

export async function updatePaymentStatementSettings(settings: PaymentStatementSettings, current: AppData) {
  const supabase = supabaseClient();
  const record = { ...settings, updatedAt: nowIso() };
  const next = { ...current, paymentStatementSettings: record };
  if (supabase) {
    await supabase.from("payment_statement_settings").upsert({
      id: "default",
      title: record.title,
      issuer_name: record.issuerName,
      issuer_address: record.issuerAddress,
      issuer_phone: record.issuerPhone,
      issuer_email: record.issuerEmail,
      registration_number: record.registrationNumber,
      payment_due_text: record.paymentDueText,
      bank_fee_text: record.bankFeeText,
      notes: record.notes,
      footer_text: record.footerText,
      updated_at: record.updatedAt
    });
  }
  saveLocal(next);
  return next;
}
