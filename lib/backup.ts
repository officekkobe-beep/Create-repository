import {
  buildClientProfitability,
  buildOutsourcePaymentSummary,
  formatPercent
} from "./calculations";
import type { AppData, DailyReport, MonthlyWorkReport } from "./types";

export const BACKUP_SCHEMA_VERSION = "2";
const RECENT_BACKUP_KEY = "sorting-daily-report-recent-backups";
const RECENT_BACKUP_LIMIT = 5;

export type BackupKind = "all" | "work_logs" | "settings";

export type RecentLocalBackup = {
  backup_created_at: string;
  backup_schema_version: string;
  last_saved_work?: DailyReport | MonthlyWorkReport;
  workers: AppData["workers"];
  clients: AppData["clients"];
  work_types: AppData["workTypes"];
  unit_prices: AppData["unitPrices"];
  sorting_unit_prices: AppData["sortingUnitPrices"];
  worker_outsource_prices: AppData["workerOutsourcePrices"];
};

function timestampForFile(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}${min}`;
}

function downloadText(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number) {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const lines = rows.map((row) => row.map(escapeCsv).join(","));
  downloadText(filename, `\uFEFF${lines.join("\r\n")}`, "text/csv;charset=utf-8");
}

export function createBackupPayload(data: AppData, kind: BackupKind) {
  const base = {
    backup_created_at: new Date().toISOString(),
    backup_schema_version: BACKUP_SCHEMA_VERSION,
    backup_type: kind
  };

  const workLogs = {
    sorting_reports: data.reports,
    monthly_work_reports: data.monthlyWorkReports
  };

  const settings = {
    clients: data.clients,
    workers: data.workers,
    work_types: data.workTypes,
    unit_prices: data.unitPrices,
    sorting_unit_prices: data.sortingUnitPrices,
    worker_outsource_prices: data.workerOutsourcePrices,
    worker_share_links: data.workerShareLinks,
    payment_statement_settings: data.paymentStatementSettings
  };

  if (kind === "work_logs") {
    return {
      ...base,
      work_logs: workLogs,
      sorting_reports: data.reports,
      monthly_work_reports: data.monthlyWorkReports
    };
  }

  if (kind === "settings") {
    return {
      ...base,
      ...settings
    };
  }

  return {
    ...base,
    work_logs: workLogs,
    sorting_reports: data.reports,
    monthly_work_reports: data.monthlyWorkReports,
    ...settings
  };
}

export function downloadBackupJson(kind: BackupKind, data: AppData) {
  const prefix = kind === "all" ? "backup_all" : kind === "work_logs" ? "backup_work_logs" : "backup_settings";
  const filename = `${prefix}_${timestampForFile()}.json`;
  downloadText(filename, JSON.stringify(createBackupPayload(data, kind), null, 2), "application/json;charset=utf-8");
  return filename;
}

export function saveRecentLocalBackup(data: AppData, lastSavedWork?: DailyReport | MonthlyWorkReport) {
  if (typeof window === "undefined") return [];
  const current = readRecentLocalBackups();
  const snapshot: RecentLocalBackup = {
    backup_created_at: new Date().toISOString(),
    backup_schema_version: BACKUP_SCHEMA_VERSION,
    last_saved_work: lastSavedWork,
    workers: data.workers,
    clients: data.clients,
    work_types: data.workTypes,
    unit_prices: data.unitPrices,
    sorting_unit_prices: data.sortingUnitPrices,
    worker_outsource_prices: data.workerOutsourcePrices
  };
  const next = [snapshot, ...current].slice(0, RECENT_BACKUP_LIMIT);
  window.localStorage.setItem(RECENT_BACKUP_KEY, JSON.stringify(next));
  return next;
}

export function readRecentLocalBackups(): RecentLocalBackup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentLocalBackup[]) : [];
  } catch {
    return [];
  }
}

export function downloadSortingReportsBackupCsv(data: AppData, month?: string) {
  const workers = new Map(data.workers.map((worker) => [worker.id, `${worker.code} ${worker.name}`]));
  const clients = new Map(data.clients.map((client) => [client.id, client.name]));
  const reports = month ? data.reports.filter((report) => report.workMonth === month) : data.reports;
  downloadCsv(`backup_sorting_reports_${month ?? "all"}_${timestampForFile()}.csv`, [
    ["作業月", "作業日", "担当者", "顧問先", "手入力件数", "スマート取込件数", "総仕訳数", "登録元", "メモ"],
    ...reports.map((report) => [
      report.workMonth,
      report.workDate,
      workers.get(report.workerId) ?? "未設定",
      clients.get(report.clientId) ?? "未設定",
      report.manualCount,
      report.smartImportCount,
      report.totalSortingCount,
      report.source === "worker_link" ? "外注者リンク入力" : "管理者入力",
      report.memo
    ])
  ]);
}

export function downloadMonthlyWorkReportsBackupCsv(data: AppData, month?: string) {
  const workers = new Map(data.workers.map((worker) => [worker.id, `${worker.code} ${worker.name}`]));
  const clients = new Map(data.clients.map((client) => [client.id, client.name]));
  const workTypes = new Map(data.workTypes.map((workType) => [workType.id, `${workType.code} ${workType.name}`]));
  const reports = month ? data.monthlyWorkReports.filter((report) => report.workMonth === month) : data.monthlyWorkReports;
  downloadCsv(`backup_monthly_work_reports_${month ?? "all"}_${timestampForFile()}.csv`, [
    ["作業月", "作業日", "担当者", "顧問先", "作業区分", "数量", "作業時間（分）", "登録元", "メモ"],
    ...reports.map((report) => [
      report.workMonth,
      report.workDate,
      workers.get(report.workerId) ?? "未設定",
      clients.get(report.clientId) ?? "未設定",
      workTypes.get(report.workTypeId) ?? "未設定",
      report.documentCount,
      report.workMinutes,
      report.source === "worker_link" ? "外注者リンク入力" : "管理者入力",
      report.memo
    ])
  ]);
}

export function downloadOutsourceDetailsBackupCsv(data: AppData, month: string) {
  const outsource = buildOutsourcePaymentSummary(data, month);
  downloadCsv(`backup_outsource_details_${month}_${timestampForFile()}.csv`, [
    ["対象月", "作業日", "担当者", "顧問先", "作業区分", "数量", "単価", "外注費", "メモ"],
    ...outsource.rows.flatMap((row) =>
      row.details.map((detail) => [month, detail.workDate, detail.workerName, detail.clientName, detail.workKind, detail.quantityLabel, detail.unitPrice, detail.amount, detail.memo])
    )
  ]);
}

export function downloadClientSummaryBackupCsv(data: AppData, month: string) {
  const rows = buildClientProfitability(data, month);
  downloadCsv(`backup_client_summary_${month}_${timestampForFile()}.csv`, [
    ["対象月", "顧問先", "売上合計", "外注費合計", "粗利", "粗利率", "手入力外注費", "スマート取込外注費", "提出書類外注費", "その他事務業務外注費"],
    ...rows.map((row) => [
      month,
      row.clientName,
      row.totalRevenue,
      row.totalOutsourceCost,
      row.grossProfit,
      formatPercent(row.grossProfitRate),
      row.manualOutsourceCost,
      row.smartOutsourceCost,
      row.submittedDocumentsOutsourceCost,
      row.officeWorkOutsourceCost
    ])
  ]);
}
