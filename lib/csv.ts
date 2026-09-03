import { formatMinutes } from "./calculations";
import type { AppData, ClientProfitabilityRow, ClientSummaryRow, DailyReport, MonthlyWorkReport, MonthlyWorkSummaryRow, SummaryRow, WorkerOutsourceSummaryRow } from "./types";

function escapeCell(value: string | number) {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function grossRate(revenue: number, profit: number) {
  return revenue ? `${((profit / revenue) * 100).toFixed(1)}%` : "0.0%";
}

export function downloadSortingDailyReportCsv(month: string, reports: DailyReport[], data: AppData) {
  const workers = new Map(data.workers.map((worker) => [worker.id, worker.name]));
  const clients = new Map(data.clients.map((client) => [client.id, client.name]));
  const header = ["作業月", "作業日", "対象年度", "決算月", "担当者", "顧問先", "手入力件数", "スマート取込件数", "前回総仕訳数", "総仕訳数", "メモ"];
  const lines = [
    header.map(escapeCell).join(","),
    ...reports.map((report) =>
      [
        month,
        report.workDate,
        report.fiscalYearLabel,
        `${report.clientClosingMonth}月`,
        workers.get(report.workerId) ?? "未設定",
        clients.get(report.clientId) ?? "未設定",
        report.manualCount,
        report.smartImportCount,
        report.previousTotalJournalCount,
        report.totalSortingCount,
        report.memo
      ]
        .map(escapeCell)
        .join(",")
    )
  ];
  downloadCsv(`sorting_daily_report_${month}.csv`, lines);
}

export function downloadMonthlyCsv(month: string, rows: SummaryRow[], clientRows: ClientSummaryRow[]) {
  const workerHeader = [
    "月",
    "顧問先",
    "対象年度",
    "担当者",
    "手入力実件数",
    "手入力控除件数",
    "手入力請求対象件数",
    "スマート取込件数",
    "スマート取込請求対象件数",
    "スマート取込控除件数",
    "請求対象合計",
    "自動計算作業件数"
  ];
  const clientHeader = [
    "月",
    "顧問先",
    "対象年度",
    "手入力実件数",
    "手入力控除件数",
    "手入力請求対象件数",
    "手入力売上",
    "手入力原価",
    "スマート取込件数",
    "スマート取込請求対象件数",
    "スマート取込控除件数",
    "スマート取込売上",
    "スマート取込原価",
    "売上合計",
    "原価合計",
    "粗利",
    "粗利率"
  ];
  const lines = [
    "担当者・顧問先別集計",
    workerHeader.map(escapeCell).join(","),
    ...rows.map((row) =>
      [
        month,
        row.clientName,
        row.fiscalYearLabels,
        row.workerName,
        row.manualCount,
        row.manualFreeAppliedCount,
        row.manualBillableCount,
        row.smartImportCount,
        row.smartBillableCount,
        row.smartFreeAppliedCount,
        row.invoiceTargetCount,
        row.autoWorkCount
      ]
        .map(escapeCell)
        .join(",")
    ),
    "",
    "顧問先別採算集計",
    clientHeader.map(escapeCell).join(","),
    ...clientRows.map((row) =>
      [
        month,
        row.clientName,
        row.fiscalYearLabels,
        row.manualCount,
        row.manualFreeAppliedCount,
        row.manualBillableCount,
        row.manualRevenue,
        row.manualCost,
        row.smartImportCount,
        row.smartBillableCount,
        row.smartFreeAppliedCount,
        row.smartRevenue,
        row.smartCost,
        row.sortingRevenue,
        row.sortingCost,
        row.sortingGrossProfit,
        grossRate(row.sortingRevenue, row.sortingGrossProfit)
      ]
        .map(escapeCell)
        .join(",")
    )
  ];
  downloadCsv(`sorting_monthly_summary_${month}.csv`, lines);
}

export function downloadMonthlyWorkReportCsv(month: string, reports: MonthlyWorkReport[], data: AppData) {
  const clients = new Map(data.clients.map((client) => [client.id, client.name]));
  const workers = new Map(data.workers.map((worker) => [worker.id, worker.name]));
  const workTypes = new Map(data.workTypes.map((workType) => [workType.id, workType.name]));
  const header = ["作業月", "作業日", "担当者", "顧問先", "作業種別", "書類数", "作業時間(分)", "メモ"];
  const lines = [
    header.map(escapeCell).join(","),
    ...reports.map((report) =>
      [
        month,
        report.workDate,
        workers.get(report.workerId) ?? "未設定",
        clients.get(report.clientId) ?? "未設定",
        workTypes.get(report.workTypeId) ?? "未設定",
        report.documentCount,
        report.workMinutes,
        report.memo
      ]
        .map(escapeCell)
        .join(",")
    )
  ];
  downloadCsv(`monthly_work_report_${month}.csv`, lines);
}

export function downloadMonthlyWorkSummaryCsv(month: string, rows: MonthlyWorkSummaryRow[]) {
  const header = ["作業月", "顧問先", "作業種別", "書類数合計", "作業時間合計", "売上単価", "原価単価", "単位", "売上", "原価", "粗利", "粗利率"];
  const lines = [
    header.map(escapeCell).join(","),
    ...rows.map((row) =>
      [
        month,
        row.clientName,
        row.workTypeName,
        row.documentCount,
        formatMinutes(row.workMinutes),
        row.revenueUnitPrice,
        row.costUnitPrice,
        row.unitLabel,
        row.revenue,
        row.cost,
        row.grossProfit,
        grossRate(row.revenue, row.grossProfit)
      ]
        .map(escapeCell)
        .join(",")
    )
  ];
  downloadCsv(`monthly_work_summary_${month}.csv`, lines);
}

export function downloadClientBillingCsv(month: string, rows: ClientProfitabilityRow[]) {
  const header = [
    "作業月",
    "顧問先",
    "仕訳作業対象年度",
    "仕訳日報売上",
    "提出書類売上",
    "その他事務業務売上",
    "売上合計",
    "手入力外注費",
    "スマート取込外注費",
    "提出書類外注費",
    "その他事務業務外注費",
    "外注費合計",
    "粗利",
    "粗利率",
    "手入力実件数",
    "手入力控除件数",
    "手入力請求対象件数",
    "手入力売上",
    "手入力原価",
    "スマート取込件数",
    "スマート取込請求対象件数",
    "スマート取込控除件数",
    "スマート取込売上",
    "スマート取込原価"
  ];
  const lines = [
    header.map(escapeCell).join(","),
    ...rows.map((row) => {
      return [
        month,
        row.clientName,
        row.sortingDetail?.fiscalYearLabels ?? "",
        row.sortingRevenue,
        row.submittedDocumentsRevenue,
        row.officeWorkRevenue,
        row.totalRevenue,
        row.manualOutsourceCost,
        row.smartOutsourceCost,
        row.submittedDocumentsOutsourceCost,
        row.officeWorkOutsourceCost,
        row.totalOutsourceCost,
        row.grossProfit,
        grossRate(row.totalRevenue, row.grossProfit),
        row.sortingDetail?.manualCount ?? 0,
        row.sortingDetail?.manualFreeAppliedCount ?? 0,
        row.sortingDetail?.manualBillableCount ?? 0,
        row.sortingDetail?.manualRevenue ?? 0,
        row.sortingDetail?.manualCost ?? 0,
        row.sortingDetail?.smartImportCount ?? 0,
        row.sortingDetail?.smartBillableCount ?? 0,
        row.sortingDetail?.smartFreeAppliedCount ?? 0,
        row.sortingDetail?.smartRevenue ?? 0,
        row.sortingDetail?.smartCost ?? 0
      ]
        .map(escapeCell)
        .join(",");
    })
  ];
  downloadCsv(`client_billing_${month}.csv`, lines);
}

export function downloadOutsourcePaymentSummaryCsv(month: string, rows: WorkerOutsourceSummaryRow[]) {
  const header = [
    "対象月",
    "担当者",
    "手入力件数",
    "手入力外注費",
    "スマート取込件数",
    "スマート取込外注費",
    "提出書類件数",
    "提出書類外注費",
    "その他事務業務時間",
    "その他事務業務外注費",
    "支払合計"
  ];
  const lines = [
    header.map(escapeCell).join(","),
    ...rows.map((row) =>
      [
        month,
        row.workerName,
        row.manualCount,
        row.manualAmount,
        row.smartImportCount,
        row.smartImportAmount,
        row.submittedDocumentsCount,
        row.submittedDocumentsAmount,
        row.officeWorkMinutes,
        row.officeWorkAmount,
        row.totalAmount
      ]
        .map(escapeCell)
        .join(",")
    )
  ];
  downloadCsv(`outsource_payment_summary_${month}.csv`, lines);
}

export function downloadOutsourcePaymentDetailCsv(month: string, rows: WorkerOutsourceSummaryRow[]) {
  const header = ["対象月", "作業日", "担当者", "顧問先", "作業区分", "数量", "単価", "外注費", "メモ"];
  const lines = [
    header.map(escapeCell).join(","),
    ...rows.flatMap((row) =>
      row.details.map((detail) =>
        [month, detail.workDate, detail.workerName, detail.clientName, detail.workKind, detail.quantityLabel, detail.unitPrice, detail.amount, detail.memo].map(escapeCell).join(",")
      )
    )
  ];
  downloadCsv(`outsource_payment_detail_${month}.csv`, lines);
}
