import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { monthFromDate } from "./calculations";
import { defaultPaymentStatementSettings, sampleData } from "./sample-data";
import type { AppData, Client, DailyReport, MonthlyWorkReport, MonthlyWorkReportInput, PaymentStatementSettings, ReportInput, SortingUnitPrice, UnitPrice, Worker, WorkerOutsourcePrice, WorkerShareLink, WorkType } from "./types";

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

function nextCode(prefix: string, existingCodes: string[]) {
  const max = existingCodes.reduce((value, code) => {
    const match = code.match(new RegExp(`^${prefix}(\\d+)$`));
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function makeUniqueCodes<T extends { id: string; code: string }>(items: T[], prefix: string) {
  const used = new Set<string>();
  return items.map((item) => {
    const current = item.code?.trim();
    if (current && !used.has(current)) {
      used.add(current);
      return { ...item, code: current };
    }
    const code = nextCode(prefix, Array.from(used));
    used.add(code);
    return { ...item, code };
  });
}

function assertUniqueCode<T extends { id: string; code: string }>(items: T[], id: string, code: string, label: string) {
  const normalized = code.trim();
  if (!normalized) throw new Error(`${label}コードを入力してください。`);
  if (items.some((item) => item.id !== id && item.code.trim() === normalized)) {
    throw new Error(`${label}コードが重複しています。別のコードを入力してください。`);
  }
}

function supabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

function emptyAppData(): AppData {
  return {
    workers: [],
    clients: [],
    workTypes: [],
    unitPrices: [],
    sortingUnitPrices: [],
    workerOutsourcePrices: [],
    workerShareLinks: [],
    paymentStatementSettings: defaultPaymentStatementSettings,
    reports: [],
    monthlyWorkReports: []
  };
}

function normalizeData(data: Partial<AppData>): AppData {
  const workers = makeUniqueCodes((data.workers ?? []).map((worker) => ({ ...worker, code: worker.code || "" })), "W");
  const workTypes = makeUniqueCodes((data.workTypes ?? []).map((workType) => ({ ...workType, code: workType.code || "" })), "T");
  return {
    workers,
    clients: data.clients ?? [],
    workTypes,
    unitPrices: (data.unitPrices ?? []).map((price) => ({ ...price, outsourceAmount: price.outsourceAmount ?? price.costAmount ?? 0 })),
    sortingUnitPrices: data.sortingUnitPrices ?? [],
    workerOutsourcePrices: data.workerOutsourcePrices ?? [],
    workerShareLinks: data.workerShareLinks ?? [],
    paymentStatementSettings: { ...defaultPaymentStatementSettings, ...(data.paymentStatementSettings ?? {}) },
    reports: (data.reports ?? []).map((report) => ({ ...report, source: report.source ?? "admin", sourceWorkerId: report.sourceWorkerId ?? "" })),
    monthlyWorkReports: (data.monthlyWorkReports ?? []).map((report) => ({ ...report, workerId: report.workerId ?? workers[0]?.id ?? "", source: report.source ?? "admin", sourceWorkerId: report.sourceWorkerId ?? "" }))
  };
}

function loadLocal(): AppData {
  if (typeof window === "undefined") return emptyAppData();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyAppData();
  const data = normalizeData(JSON.parse(raw) as Partial<AppData>);
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

function mergeById<T extends { id: string }>(current: T[], samples: T[]) {
  return [...current, ...samples.filter((sample) => !current.some((item) => item.id === sample.id))];
}

function mergeByKey<T>(current: T[], samples: T[], keyOf: (item: T) => string) {
  return [...current, ...samples.filter((sample) => !current.some((item) => keyOf(item) === keyOf(sample)))];
}

export async function createSampleData(current: AppData) {
  const supabase = supabaseClient();
  const next: AppData = {
    ...current,
    workers: mergeById(current.workers, sampleData.workers),
    clients: mergeById(current.clients, sampleData.clients),
    reports: mergeById(current.reports, sampleData.reports),
    workTypes: mergeById(current.workTypes, sampleData.workTypes),
    unitPrices: mergeByKey(current.unitPrices, sampleData.unitPrices, (item) => item.workTypeId),
    sortingUnitPrices: mergeByKey(current.sortingUnitPrices, sampleData.sortingUnitPrices, (item) => item.id),
    workerOutsourcePrices: mergeByKey(current.workerOutsourcePrices, sampleData.workerOutsourcePrices, (item) => item.workerId),
    monthlyWorkReports: mergeById(current.monthlyWorkReports, sampleData.monthlyWorkReports)
  };

  if (supabase) {
    const missingWorkers = sampleData.workers.filter((sample) => !current.workers.some((item) => item.id === sample.id));
    const missingClients = sampleData.clients.filter((sample) => !current.clients.some((item) => item.id === sample.id));
    const missingWorkTypes = sampleData.workTypes.filter((sample) => !current.workTypes.some((item) => item.id === sample.id));
    const missingUnitPrices = sampleData.unitPrices.filter((sample) => !current.unitPrices.some((item) => item.workTypeId === sample.workTypeId));
    const missingSortingUnitPrices = sampleData.sortingUnitPrices.filter((sample) => !current.sortingUnitPrices.some((item) => item.id === sample.id));
    const missingWorkerOutsourcePrices = sampleData.workerOutsourcePrices.filter((sample) => !current.workerOutsourcePrices.some((item) => item.workerId === sample.workerId));
    const missingReports = sampleData.reports.filter((sample) => !current.reports.some((item) => item.id === sample.id));
    const missingMonthlyReports = sampleData.monthlyWorkReports.filter((sample) => !current.monthlyWorkReports.some((item) => item.id === sample.id));

    if (missingWorkers.length) await supabase.from("workers").upsert(missingWorkers.map((worker) => ({ id: worker.id, worker_code: worker.code, name: worker.name, active: true, is_active: true, created_at: worker.createdAt })));
    if (missingClients.length) await supabase.from("clients").upsert(missingClients.map((client) => ({ id: client.id, name: client.name, code: client.code, active: true, is_active: true, created_at: client.createdAt })));
    if (missingWorkTypes.length) await supabase.from("work_types").upsert(missingWorkTypes.map((workType) => ({ id: workType.id, work_type_code: workType.code, name: workType.name, unit: workType.unit, unit_type: workType.unit, active: workType.active, is_active: workType.active, created_at: workType.createdAt })));
    if (missingUnitPrices.length) await supabase.from("unit_prices").upsert(
      missingUnitPrices.map((price) => ({
        work_type_id: price.workTypeId,
        amount: price.amount,
        cost_amount: price.costAmount,
        outsource_amount: price.outsourceAmount,
        outsource_unit_price: price.outsourceAmount,
        quantity: price.quantity,
        unit_label: price.unitLabel,
        created_at: price.createdAt,
        updated_at: price.updatedAt
      }))
    );
    if (missingSortingUnitPrices.length) await supabase.from("sorting_unit_prices").upsert(
      missingSortingUnitPrices.map((price) => ({
        id: price.id,
        name: price.name,
        amount: price.amount,
        cost_amount: price.costAmount,
        quantity: price.quantity,
        unit_label: price.unitLabel,
        created_at: price.createdAt,
        updated_at: price.updatedAt
      }))
    );
    if (missingWorkerOutsourcePrices.length) await supabase.from("worker_outsource_prices").upsert(
      missingWorkerOutsourcePrices.map((price) => ({
        worker_id: price.workerId,
        manual_unit_price: price.manualUnitPrice,
        smart_unit_price: price.smartUnitPrice,
        submitted_documents_unit_price: price.submittedDocumentsUnitPrice,
        office_work_unit_price: price.officeWorkUnitPrice,
        created_at: price.createdAt,
        updated_at: price.updatedAt
      }))
    );
    if (missingReports.length) await supabase.from("daily_reports").upsert(missingReports.map(fromReport));
    if (missingMonthlyReports.length) await supabase.from("monthly_work_reports").upsert(missingMonthlyReports.map(fromMonthlyWorkReport));
  }

  saveLocal(next);
  return next;
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
      "Supabase fetch failed. Local sample data will not be merged.",
      workersResult.error ?? clientsResult.error ?? reportsResult.error ?? workTypesResult.error ?? unitPricesResult.error ?? sortingUnitPricesResult.error ?? workerOutsourcePricesResult.error ?? workerShareLinksResult.error ?? paymentStatementSettingsResult.error ?? monthlyWorkReportsResult.error
    );
    return { data: emptyAppData(), mode: "supabase" };
  }

  return {
    mode: "supabase",
    data: normalizeData({
      workers: (workersResult.data ?? []).map((row) => ({
        id: row.id,
        code: row.worker_code ?? row.code ?? "",
        name: row.name,
        active: row.is_active ?? row.active ?? true,
        createdAt: row.created_at
      })),
      clients: (clientsResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        active: row.is_active ?? row.active ?? true,
        createdAt: row.created_at
      })),
      reports: (reportsResult.data ?? []).map(toReport),
      workTypes: (workTypesResult.data ?? []).map((row) => ({
        id: row.id,
        code: row.work_type_code ?? row.code ?? "",
        name: row.name,
        unit: row.unit_type ?? row.unit,
        active: row.is_active ?? row.active ?? true,
        createdAt: row.created_at
      })),
      unitPrices: (unitPricesResult.data ?? []).map((row) => ({
        workTypeId: row.work_type_id,
        amount: row.amount,
        costAmount: row.cost_amount ?? 0,
        outsourceAmount: row.outsource_amount ?? row.outsource_unit_price ?? 0,
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
  const id = worker.id ?? createId("worker");
  const code = worker.code?.trim() || nextCode("W", current.workers.map((item) => item.code));
  assertUniqueCode(current.workers, id, code, "担当者");
  const record: Worker = {
    id,
    code,
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
    await supabase.from("workers").upsert({ id: record.id, worker_code: record.code, name: record.name, active: record.active, is_active: record.active, created_at: record.createdAt });
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
  const next = {
    ...current,
    workers: current.workers.map((item) => (item.id === id ? { ...item, active: false } : item)),
    workerShareLinks: current.workerShareLinks.map((item) => (item.workerId === id ? { ...item, active: false, updatedAt: nowIso() } : item))
  };
  if (supabase) {
    await supabase.from("worker_share_links").update({ active: false, updated_at: nowIso() }).eq("worker_id", id);
    await supabase.from("workers").update({ active: false }).eq("id", id);
  }
  saveLocal(next);
  return next;
}

export async function deleteWorkerPermanently(id: string, current: AppData) {
  const usedInReports = current.reports.some((report) => report.workerId === id) || current.monthlyWorkReports.some((report) => report.workerId === id);
  const usedInLinks = current.workerShareLinks.some((link) => link.workerId === id);
  if (usedInReports || usedInLinks) {
    throw new Error("この担当者は過去の作業履歴または共有リンクで使用されているため削除できません。無効化してください。");
  }
  const supabase = supabaseClient();
  const next = {
    ...current,
    workers: current.workers.filter((item) => item.id !== id),
    workerOutsourcePrices: current.workerOutsourcePrices.filter((item) => item.workerId !== id)
  };
  if (supabase) {
    await supabase.from("worker_outsource_prices").delete().eq("worker_id", id);
    await supabase.from("workers").delete().eq("id", id);
  }
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
  const id = client.id ?? createId("client");
  const code = client.code?.trim() ?? "";
  assertUniqueCode(current.clients, id, code, "顧問先");
  const record: Client = {
    id,
    name: client.name.trim(),
    code,
    active: client.active ?? true,
    createdAt: client.createdAt ?? nowIso()
  };
  const next = { ...current, clients: [...current.clients.filter((item) => item.id !== record.id), record] };
  if (supabase) await supabase.from("clients").upsert({ id: record.id, name: record.name, code: record.code, active: record.active, is_active: record.active, created_at: record.createdAt });
  saveLocal(next);
  return next;
}

export async function deleteClient(id: string, current: AppData) {
  const supabase = supabaseClient();
  const next = { ...current, clients: current.clients.map((item) => (item.id === id ? { ...item, active: false } : item)) };
  if (supabase) await supabase.from("clients").update({ active: false, is_active: false }).eq("id", id);
  saveLocal(next);
  return next;
}

export async function deleteClientPermanently(id: string, current: AppData) {
  const used = current.reports.some((report) => report.clientId === id) || current.monthlyWorkReports.some((report) => report.clientId === id);
  if (used) throw new Error("この顧問先は過去の作業履歴で使用されているため削除できません。無効化してください。");
  const supabase = supabaseClient();
  const next = { ...current, clients: current.clients.filter((item) => item.id !== id) };
  if (supabase) await supabase.from("clients").delete().eq("id", id);
  saveLocal(next);
  return next;
}

export async function upsertWorkTypeWithPrice(workType: Partial<WorkType> & Pick<WorkType, "name" | "unit">, price: Partial<UnitPrice>, current: AppData) {
  const supabase = supabaseClient();
  const existing = workType.id ? current.workTypes.find((item) => item.id === workType.id) : undefined;
  const id = workType.id ?? createId("work-type");
  const code = workType.code?.trim() || existing?.code || nextCode("T", current.workTypes.map((item) => item.code));
  assertUniqueCode(current.workTypes, id, code, "作業種別");
  const record: WorkType = {
    id,
    code,
    name: workType.name.trim(),
    unit: workType.unit,
    active: workType.active ?? existing?.active ?? true,
    createdAt: workType.createdAt ?? existing?.createdAt ?? nowIso()
  };
  const unitQuantity = record.unit === "count" ? 1 : 10;
  const unitLabel = record.unit === "count" ? "1件あたり" : "10分あたり";
  const existingPrice = current.unitPrices.find((item) => item.workTypeId === id);
  const priceRecord: UnitPrice = {
    workTypeId: id,
    amount: Number(price.amount ?? existingPrice?.amount ?? 0),
    costAmount: Number(price.costAmount ?? existingPrice?.costAmount ?? 0),
    outsourceAmount: Number(price.outsourceAmount ?? existingPrice?.outsourceAmount ?? 0),
    quantity: unitQuantity,
    unitLabel,
    createdAt: existingPrice?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
  const next = {
    ...current,
    workTypes: [...current.workTypes.filter((item) => item.id !== id), record].sort((a, b) => a.code.localeCompare(b.code, "ja")),
    unitPrices: [...current.unitPrices.filter((item) => item.workTypeId !== id), priceRecord]
  };
  if (supabase) {
    await supabase.from("work_types").upsert({
      id: record.id,
      work_type_code: record.code,
      name: record.name,
      unit: record.unit,
      unit_type: record.unit,
      active: record.active,
      is_active: record.active,
      created_at: record.createdAt
    });
    await supabase.from("unit_prices").upsert({
      work_type_id: priceRecord.workTypeId,
      amount: priceRecord.amount,
      cost_amount: priceRecord.costAmount,
      outsource_amount: priceRecord.outsourceAmount,
      outsource_unit_price: priceRecord.outsourceAmount,
      quantity: priceRecord.quantity,
      unit_label: priceRecord.unitLabel,
      created_at: priceRecord.createdAt,
      updated_at: priceRecord.updatedAt
    });
  }
  saveLocal(next);
  return next;
}

export async function deleteWorkType(id: string, current: AppData) {
  const supabase = supabaseClient();
  const next = { ...current, workTypes: current.workTypes.map((item) => (item.id === id ? { ...item, active: false } : item)) };
  if (supabase) await supabase.from("work_types").update({ active: false, is_active: false }).eq("id", id);
  saveLocal(next);
  return next;
}

export async function deleteWorkTypePermanently(id: string, current: AppData) {
  const used = current.monthlyWorkReports.some((report) => report.workTypeId === id);
  if (used) throw new Error("この作業種別は過去の作業履歴で使用されているため削除できません。無効化してください。");
  const supabase = supabaseClient();
  const next = {
    ...current,
    workTypes: current.workTypes.filter((item) => item.id !== id),
    unitPrices: current.unitPrices.filter((item) => item.workTypeId !== id)
  };
  if (supabase) {
    await supabase.from("unit_prices").delete().eq("work_type_id", id);
    await supabase.from("work_types").delete().eq("id", id);
  }
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
      outsource_amount: record.outsourceAmount,
      outsource_unit_price: record.outsourceAmount,
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
