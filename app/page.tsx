"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  buildClientProfitability,
  buildMonthlySummary,
  buildMonthlyWorkSummary,
  buildOutsourcePaymentSummary,
  calculateAutoWorkCount,
  findPreviousReport,
  formatCurrency,
  formatMinutes,
  formatNumber,
  formatPercent,
  getCurrentMonth,
  monthFromDate,
  unitLabel
} from "@/lib/calculations";
import {
  downloadClientBillingCsv,
  downloadMonthlyCsv,
  downloadMonthlyWorkReportCsv,
  downloadMonthlyWorkSummaryCsv,
  downloadOutsourcePaymentDetailCsv,
  downloadOutsourcePaymentSummaryCsv,
  downloadSortingDailyReportCsv
} from "@/lib/csv";
import {
  downloadBackupJson,
  downloadClientSummaryBackupCsv,
  downloadMonthlyWorkReportsBackupCsv,
  downloadOutsourceDetailsBackupCsv,
  downloadSortingReportsBackupCsv,
  readRecentLocalBackups,
  saveRecentLocalBackup,
  type BackupKind,
  type RecentLocalBackup
} from "@/lib/backup";
import {
  deleteClient,
  deleteMonthlyWorkReport,
  deleteReport,
  deleteWorker,
  fetchData,
  issueWorkerShareLink,
  toggleWorkerShareLink,
  updatePaymentStatementSettings,
  updateSortingUnitPrice,
  updateUnitPrice,
  updateWorkerOutsourcePrice,
  upsertClient,
  upsertMonthlyWorkReport,
  upsertReport,
  upsertWorker
} from "@/lib/storage";
import {
  calculateSortingCountState,
  emptySortingCountState,
  normalizeCountInput,
  parseCountInput,
  sortingCountStateFromValues,
  valuesFromCountInputs,
  type SortingCountKey,
  type SortingCountState
} from "@/lib/sorting-count";
import type {
  AppData,
  Client,
  DailyReport,
  MonthlyWorkReport,
  MonthlyWorkReportInput,
  PaymentStatementSettings,
  ReportInput,
  SortingUnitPrice,
  UnitPrice,
  Worker,
  WorkerOutsourcePrice,
  WorkerOutsourceSummaryRow,
  WorkType
} from "@/lib/types";

type MainTab = "input" | "summary" | "outsource" | "more";
type MoreTab = "home" | "list" | "billing" | "backup" | "settings";
type WorkKind = "sorting" | "submitted-documents" | "office-work";
type SettingsTab = "clients" | "workers" | "workTypes" | "prices" | "paymentStatement" | "backup";

type BackupPreview = {
  fileName: string;
  backupCreatedAt: string;
  backupSchemaVersion: string;
  backupType: string;
  sortingReports: number;
  monthlyWorkReports: number;
  clients: number;
  workers: number;
  unitPrices: number;
  workerOutsourcePrices: number;
  workerShareLinks: number;
  hasPaymentStatementSettings: boolean;
};

const emptySettings: PaymentStatementSettings = {
  title: "支払明細書",
  issuerName: "",
  issuerAddress: "",
  issuerPhone: "",
  issuerEmail: "",
  registrationNumber: "",
  paymentDueText: "翌月末払い",
  bankFeeText: "振込手数料は受取人負担とします。",
  notes: "",
  footerText: "ご確認ありがとうございます。",
  updatedAt: ""
};

const emptyData: AppData = {
  workers: [],
  clients: [],
  reports: [],
  workTypes: [],
  unitPrices: [],
  sortingUnitPrices: [],
  workerOutsourcePrices: [],
  workerShareLinks: [],
  paymentStatementSettings: emptySettings,
  monthlyWorkReports: []
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function blankSorting(data: AppData): ReportInput {
  return {
    workDate: todayDate(),
    workerId: data.workers.find((worker) => worker.active)?.id ?? "",
    clientId: data.clients.find((client) => client.active)?.id ?? "",
    manualCount: 0,
    smartImportCount: 0,
    totalSortingCount: 0,
    memo: ""
  };
}

function blankMonthly(data: AppData, kind: WorkKind): MonthlyWorkReportInput {
  return {
    workDate: todayDate(),
    workerId: data.workers.find((worker) => worker.active)?.id ?? "",
    workTypeId: kind === "office-work" ? "office-work" : "submitted-documents",
    clientId: data.clients.find((client) => client.active)?.id ?? "",
    documentCount: 0,
    workMinutes: 0,
    memo: ""
  };
}

function latestByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function safeText(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function fileSafeName(value: string) {
  return value.replace(/[\\/:*?"<>|\s]+/g, "_");
}

export default function Home() {
  const [data, setData] = useState<AppData>(emptyData);
  const [mainTab, setMainTab] = useState<MainTab>("input");
  const [moreTab, setMoreTab] = useState<MoreTab>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("clients");
  const [month, setMonth] = useState(getCurrentMonth());
  const [mode, setMode] = useState<"supabase" | "local">("local");
  const [workKind, setWorkKind] = useState<WorkKind>("sorting");
  const [editingSorting, setEditingSorting] = useState<DailyReport | null>(null);
  const [editingMonthly, setEditingMonthly] = useState<MonthlyWorkReport | null>(null);
  const [sortingForm, setSortingForm] = useState<ReportInput>(blankSorting(emptyData));
  const [sortingCountState, setSortingCountState] = useState<SortingCountState>(emptySortingCountState());
  const [monthlyForm, setMonthlyForm] = useState<MonthlyWorkReportInput>(blankMonthly(emptyData, "submitted-documents"));
  const [workerForm, setWorkerForm] = useState<Partial<Worker> & Pick<Worker, "name">>({ name: "" });
  const [clientForm, setClientForm] = useState<Partial<Client> & Pick<Client, "name">>({ name: "", code: "" });
  const [priceForms, setPriceForms] = useState<Record<string, UnitPrice>>({});
  const [sortingPriceForms, setSortingPriceForms] = useState<Record<string, SortingUnitPrice>>({});
  const [outsourcePriceForms, setOutsourcePriceForms] = useState<Record<string, WorkerOutsourcePrice>>({});
  const [paymentSettingsForm, setPaymentSettingsForm] = useState<PaymentStatementSettings>(emptySettings);
  const [selectedOutsourceWorkerId, setSelectedOutsourceWorkerId] = useState("");
  const [recentLocalBackups, setRecentLocalBackups] = useState<RecentLocalBackup[]>([]);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchData().then((result) => {
      setData(result.data);
      setMode(result.mode);
      setSortingForm(blankSorting(result.data));
      setSortingCountState(emptySortingCountState());
      setMonthlyForm(blankMonthly(result.data, "submitted-documents"));
      setPriceForms(Object.fromEntries(result.data.unitPrices.map((price) => [price.workTypeId, price])));
      setSortingPriceForms(Object.fromEntries(result.data.sortingUnitPrices.map((price) => [price.id, price])));
      setOutsourcePriceForms(Object.fromEntries(result.data.workerOutsourcePrices.map((price) => [price.workerId, price])));
      setPaymentSettingsForm(result.data.paymentStatementSettings);
      setRecentLocalBackups(readRecentLocalBackups());
    });
  }, []);

  const workers = useMemo(() => new Map(data.workers.map((worker) => [worker.id, worker.name])), [data.workers]);
  const clients = useMemo(() => new Map(data.clients.map((client) => [client.id, client.name])), [data.clients]);
  const workTypes = useMemo(() => new Map(data.workTypes.map((workType) => [workType.id, workType])), [data.workTypes]);
  const sortingSummary = useMemo(() => buildMonthlySummary(data, month), [data, month]);
  const monthlySummary = useMemo(() => buildMonthlyWorkSummary(data, month), [data, month]);
  const outsourceSummary = useMemo(() => buildOutsourcePaymentSummary(data, month), [data, month]);
  const clientProfitability = useMemo(() => buildClientProfitability(data, month), [data, month]);
  const monthlySortingReports = useMemo(() => data.reports.filter((report) => report.workMonth === month), [data.reports, month]);

  const allWork = useMemo(
    () =>
      [
        ...data.reports.map((report) => ({ id: report.id, date: report.workDate, kind: "仕訳作業", client: clients.get(report.clientId) ?? "未設定", worker: workers.get(report.workerId) ?? "未設定", memo: report.memo })),
        ...data.monthlyWorkReports.map((report) => ({ id: report.id, date: report.workDate, kind: workTypes.get(report.workTypeId)?.name ?? "未設定", client: clients.get(report.clientId) ?? "未設定", worker: workers.get(report.workerId) ?? "未設定", memo: report.memo }))
      ].sort((a, b) => b.date.localeCompare(a.date)),
    [clients, data.monthlyWorkReports, data.reports, workers, workTypes]
  );

  const profitability = useMemo(() => {
    const revenue = clientProfitability.reduce((sum, row) => sum + row.totalRevenue, 0);
    const outsourceCost = clientProfitability.reduce((sum, row) => sum + row.totalOutsourceCost, 0);
    const grossProfit = revenue - outsourceCost;
    return { revenue, outsourceCost, grossProfit, grossProfitRate: revenue ? (grossProfit / revenue) * 100 : 0 };
  }, [clientProfitability]);

  const previousSorting = useMemo(() => {
    if (!sortingForm.clientId || !sortingForm.workDate) return undefined;
    return findPreviousReport(data.reports, {
      id: editingSorting?.id ?? "",
      clientId: sortingForm.clientId,
      workDate: sortingForm.workDate,
      createdAt: editingSorting?.createdAt ?? new Date().toISOString()
    });
  }, [data.reports, editingSorting, sortingForm.clientId, sortingForm.workDate]);
  const previousTotalSortingCount = previousSorting?.totalSortingCount;

  useEffect(() => {
    if (workKind !== "sorting") return;
    const recalculated = calculateSortingCountState(sortingCountState, previousTotalSortingCount);
    if (JSON.stringify(recalculated) === JSON.stringify(sortingCountState)) return;
    setSortingCountState(recalculated);
    setSortingForm((current) => ({ ...current, ...valuesFromCountInputs(recalculated.inputs) }));
  }, [previousTotalSortingCount, workKind]);

  function notify(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2600);
  }

  function exportCsv(action: () => void) {
    action();
    notify("CSVを出力しました。");
  }

  function exportBackup(kind: BackupKind) {
    downloadBackupJson(kind, data);
    notify("バックアップJSONを出力しました。");
  }

  function exportBackupCsv(action: () => void) {
    action();
    notify("CSVバックアップを出力しました。");
  }

  function refreshRecentBackups(nextData: AppData, savedWork?: DailyReport | MonthlyWorkReport) {
    setRecentLocalBackups(saveRecentLocalBackup(nextData, savedWork));
  }

  async function previewBackupFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const workLogs = (parsed.work_logs ?? {}) as Record<string, unknown>;
      const sortingReports = (parsed.sorting_reports ?? workLogs.sorting_reports ?? []) as unknown[];
      const monthlyWorkReports = (parsed.monthly_work_reports ?? workLogs.monthly_work_reports ?? []) as unknown[];
      setBackupPreview({
        fileName: file.name,
        backupCreatedAt: String(parsed.backup_created_at ?? ""),
        backupSchemaVersion: String(parsed.backup_schema_version ?? ""),
        backupType: String(parsed.backup_type ?? ""),
        sortingReports: Array.isArray(sortingReports) ? sortingReports.length : 0,
        monthlyWorkReports: Array.isArray(monthlyWorkReports) ? monthlyWorkReports.length : 0,
        clients: Array.isArray(parsed.clients) ? parsed.clients.length : 0,
        workers: Array.isArray(parsed.workers) ? parsed.workers.length : 0,
        unitPrices: Array.isArray(parsed.unit_prices) ? parsed.unit_prices.length : 0,
        workerOutsourcePrices: Array.isArray(parsed.worker_outsource_prices) ? parsed.worker_outsource_prices.length : 0,
        workerShareLinks: Array.isArray(parsed.worker_share_links) ? parsed.worker_share_links.length : 0,
        hasPaymentStatementSettings: Boolean(parsed.payment_statement_settings)
      });
      notify("バックアップ内容を確認しました。");
    } catch {
      setBackupPreview(null);
      notify("バックアップJSONを読み込めませんでした。");
    }
  }

  function switchWorkKind(kind: WorkKind) {
    setWorkKind(kind);
    if (kind === "sorting") {
      setEditingSorting(null);
      setSortingForm(blankSorting(data));
      setSortingCountState(emptySortingCountState());
      return;
    }
    setEditingMonthly(null);
    setMonthlyForm(blankMonthly(data, kind));
  }

  function updateSortingCount(field: SortingCountKey, rawValue: string) {
    const normalized = normalizeCountInput(rawValue);
    const calculatedState = calculateSortingCountState({
      ...sortingCountState,
      inputs: { ...sortingCountState.inputs, [field]: normalized },
      manual: { ...sortingCountState.manual, [field]: normalized !== "" }
    }, previousTotalSortingCount);
    setSortingCountState(calculatedState);
    setSortingForm({ ...sortingForm, ...valuesFromCountInputs(calculatedState.inputs) });
  }

  function validateSortingCounts() {
    const total = parseCountInput(sortingCountState.inputs.totalSortingCount);
    const manual = parseCountInput(sortingCountState.inputs.manualCount);
    const smart = parseCountInput(sortingCountState.inputs.smartImportCount);
    const previous = previousTotalSortingCount ?? 0;
    if (total === null || manual === null || smart === null) return "総仕訳数、手入力件数、スマート取込件数を入力してください";
    if (total - previous < 0) return "入力値を確認してください。計算結果がマイナスになります";
    if (total - previous !== manual + smart) return "今回作業件数と、手入力件数＋スマート取込件数が一致していません";
    return "";
  }

  async function submitSorting(event: FormEvent) {
    event.preventDefault();
    if (!sortingForm.workerId || !sortingForm.clientId) return notify("担当者と顧問先を選択してください。");
    const countError = validateSortingCounts();
    if (countError) return notify(countError);
    const next = await upsertReport({ ...sortingForm, id: editingSorting?.id }, data);
    setData(next);
    refreshRecentBackups(next, editingSorting ? next.reports.find((report) => report.id === editingSorting.id) : latestByUpdatedAt(next.reports));
    setEditingSorting(null);
    setSortingForm(blankSorting(next));
    setSortingCountState(emptySortingCountState());
    notify("仕訳作業を保存しました。");
  }

  async function submitMonthly(event: FormEvent) {
    event.preventDefault();
    if (!monthlyForm.workerId || !monthlyForm.clientId) return notify("担当者と顧問先を選択してください。");
    const kind = workKind === "office-work" ? "office-work" : "submitted-documents";
    if (kind === "submitted-documents" && monthlyForm.documentCount <= 0) return notify("書類数を入力してください。");
    if (kind === "office-work" && monthlyForm.workMinutes <= 0) return notify("作業時間（分）を入力してください。");
    const next = await upsertMonthlyWorkReport(
      {
        ...monthlyForm,
        workTypeId: kind,
        documentCount: kind === "submitted-documents" ? monthlyForm.documentCount : 0,
        workMinutes: kind === "office-work" ? monthlyForm.workMinutes : 0,
        id: editingMonthly?.id
      },
      data
    );
    setData(next);
    refreshRecentBackups(next, editingMonthly ? next.monthlyWorkReports.find((report) => report.id === editingMonthly.id) : latestByUpdatedAt(next.monthlyWorkReports));
    setEditingMonthly(null);
    setMonthlyForm(blankMonthly(next, kind));
    notify("月次作業を保存しました。");
  }

  function editSorting(report: DailyReport) {
    setWorkKind("sorting");
    setEditingSorting(report);
    setSortingForm({ workDate: report.workDate, workerId: report.workerId, clientId: report.clientId, manualCount: report.manualCount, smartImportCount: report.smartImportCount, totalSortingCount: report.totalSortingCount, memo: report.memo });
    setSortingCountState(sortingCountStateFromValues(report));
    setMainTab("input");
  }

  function editMonthly(report: MonthlyWorkReport) {
    setWorkKind(report.workTypeId);
    setEditingMonthly(report);
    setMonthlyForm({ workDate: report.workDate, workerId: report.workerId, workTypeId: report.workTypeId, clientId: report.clientId, documentCount: report.documentCount, workMinutes: report.workMinutes, memo: report.memo });
    setMainTab("input");
  }

  async function submitWorker(event: FormEvent) {
    event.preventDefault();
    if (!workerForm.name.trim()) return notify("担当者名を入力してください。");
    const next = await upsertWorker(workerForm, data);
    setData(next);
    setOutsourcePriceForms(Object.fromEntries(next.workerOutsourcePrices.map((price) => [price.workerId, price])));
    setWorkerForm({ name: "" });
    notify("担当者を保存しました。");
  }

  async function issueShareLink(workerId: string) {
    const next = await issueWorkerShareLink(workerId, data);
    setData(next);
    notify("共有リンクを発行しました。");
  }

  async function toggleShareLink(workerId: string, active: boolean) {
    const next = await toggleWorkerShareLink(workerId, active, data);
    setData(next);
    notify(active ? "共有リンクを有効にしました。" : "共有リンクを無効にしました。");
  }

  async function copyShareLink(token: string) {
    const url = `${window.location.origin}/worker/${token}`;
    await navigator.clipboard.writeText(url);
    notify("共有リンクをコピーしました。");
  }

  async function submitClient(event: FormEvent) {
    event.preventDefault();
    if (!clientForm.name.trim()) return notify("顧問先名を入力してください。");
    setData(await upsertClient(clientForm, data));
    setClientForm({ name: "", code: "" });
    notify("顧問先を保存しました。");
  }

  async function submitPrice(event: FormEvent, price: UnitPrice) {
    event.preventDefault();
    const next = await updateUnitPrice(price, data);
    setData(next);
    setPriceForms(Object.fromEntries(next.unitPrices.map((item) => [item.workTypeId, item])));
    notify("単価を保存しました。");
  }

  async function submitSortingPrice(event: FormEvent, price: SortingUnitPrice) {
    event.preventDefault();
    const next = await updateSortingUnitPrice(price, data);
    setData(next);
    setSortingPriceForms(Object.fromEntries(next.sortingUnitPrices.map((item) => [item.id, item])));
    notify("単価を保存しました。");
  }

  async function submitOutsourcePrice(event: FormEvent, price: WorkerOutsourcePrice) {
    event.preventDefault();
    const next = await updateWorkerOutsourcePrice(price, data);
    setData(next);
    setOutsourcePriceForms(Object.fromEntries(next.workerOutsourcePrices.map((item) => [item.workerId, item])));
    notify("外注単価を保存しました。");
  }

  async function submitPaymentSettings(event: FormEvent) {
    event.preventDefault();
    const next = await updatePaymentStatementSettings(paymentSettingsForm, data);
    setData(next);
    setPaymentSettingsForm(next.paymentStatementSettings);
    notify("支払明細書設定を保存しました。");
  }

  function printPaymentStatement(workerRow: WorkerOutsourceSummaryRow) {
    const settings = data.paymentStatementSettings;
    const issueDate = new Date().toLocaleDateString("ja-JP");
    const filename = `payment_statement_${fileSafeName(workerRow.workerName)}_${month}.pdf`;
    const detailRows = workerRow.details
      .map(
        (detail) => `
          <tr>
            <td>${safeText(detail.workDate)}</td>
            <td>${safeText(detail.clientName)}</td>
            <td>${safeText(detail.workKind)}</td>
            <td class="right">${safeText(detail.quantityLabel)}</td>
            <td class="right">${formatCurrency(detail.unitPrice)}</td>
            <td class="right">${formatCurrency(detail.amount)}</td>
            <td>${safeText(detail.memo)}</td>
          </tr>`
      )
      .join("");
    const html = `
      <!doctype html>
      <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>${filename}</title>
        <style>
          @page { size: A4 portrait; margin: 16mm; }
          body { font-family: "Yu Gothic", "Meiryo", sans-serif; color: #172033; line-height: 1.5; }
          h1 { text-align: center; font-size: 24px; margin: 0 0 18px; }
          .header { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; font-size: 12px; }
          .box { border: 1px solid #cfd7e3; padding: 10px; border-radius: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th { background: #f1f5f9; }
          th, td { border: 1px solid #cfd7e3; padding: 6px; vertical-align: top; }
          .right { text-align: right; }
          .summary { margin-top: 16px; width: 55%; margin-left: auto; }
          .footer { margin-top: 18px; font-size: 11px; color: #475569; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">PDFとして保存 / 印刷</button>
        <h1>${safeText(settings.title || "支払明細書")}</h1>
        <div class="header">
          <div class="box">
            <div><strong>対象月:</strong> ${safeText(month)}</div>
            <div><strong>発行日:</strong> ${safeText(issueDate)}</div>
            <div><strong>支払先名:</strong> ${safeText(workerRow.workerName)}</div>
            <div><strong>支払予定日:</strong> ${safeText(settings.paymentDueText)}</div>
          </div>
          <div class="box">
            <div><strong>発行者名:</strong> ${safeText(settings.issuerName)}</div>
            <div><strong>住所:</strong> ${safeText(settings.issuerAddress)}</div>
            <div><strong>電話:</strong> ${safeText(settings.issuerPhone)}</div>
            <div><strong>メール:</strong> ${safeText(settings.issuerEmail)}</div>
            <div><strong>登録番号等:</strong> ${safeText(settings.registrationNumber)}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>作業日</th><th>顧問先</th><th>作業区分</th><th>数量</th><th>単価</th><th>金額</th><th>メモ</th></tr>
          </thead>
          <tbody>${detailRows || `<tr><td colspan="7">明細はありません。</td></tr>`}</tbody>
        </table>
        <table class="summary">
          <tbody>
            <tr><th>手入力外注費</th><td class="right">${formatCurrency(workerRow.manualAmount)}</td></tr>
            <tr><th>スマート取込外注費</th><td class="right">${formatCurrency(workerRow.smartImportAmount)}</td></tr>
            <tr><th>提出書類外注費</th><td class="right">${formatCurrency(workerRow.submittedDocumentsAmount)}</td></tr>
            <tr><th>その他事務業務外注費</th><td class="right">${formatCurrency(workerRow.officeWorkAmount)}</td></tr>
            <tr><th>支払合計</th><td class="right"><strong>${formatCurrency(workerRow.totalAmount)}</strong></td></tr>
          </tbody>
        </table>
        <div class="footer">
          <p><strong>振込手数料:</strong> ${safeText(settings.bankFeeText)}</p>
          <p><strong>備考:</strong> ${safeText(settings.notes)}</p>
          <p>${safeText(settings.footerText)}</p>
        </div>
        <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
      </body>
      </html>`;
    const win = window.open("", "_blank");
    if (!win) {
      notify("ポップアップがブロックされました。ブラウザ設定を確認してください。");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    notify("支払明細PDFを出力しました。");
  }

  return (
    <main className="min-h-screen bg-surface">
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-brand">日報管理</p>
              <h1 className="text-2xl font-bold text-ink">仕訳作業・月次作業</h1>
            </div>
            <span className="w-fit rounded-full border border-line bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-600">保存先: {mode === "supabase" ? "Supabase" : "ローカル"}</span>
          </div>
          <nav className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MainButton active={mainTab === "input"} onClick={() => setMainTab("input")} label="作業入力" />
            <MainButton active={mainTab === "summary"} onClick={() => setMainTab("summary")} label="月次集計" />
            <MainButton active={mainTab === "outsource"} onClick={() => setMainTab("outsource")} label="外注費支払" />
            <MainButton active={mainTab === "more"} onClick={() => setMainTab("more")} label="その他" />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {message ? <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">{message}</div> : null}

        {mainTab === "input" ? (
          <section className="panel p-5">
            <h2 className="text-xl font-bold">作業入力</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <ChoiceButton active={workKind === "sorting"} onClick={() => switchWorkKind("sorting")} label="仕訳作業" />
              <ChoiceButton active={workKind === "submitted-documents"} onClick={() => switchWorkKind("submitted-documents")} label="提出書類" />
              <ChoiceButton active={workKind === "office-work"} onClick={() => switchWorkKind("office-work")} label="その他事務業務" />
            </div>
            {workKind === "sorting" ? (
              <form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={submitSorting}>
                <DateField value={sortingForm.workDate} onChange={(value) => setSortingForm({ ...sortingForm, workDate: value })} />
                <SelectField label="担当者" value={sortingForm.workerId} onChange={(value) => setSortingForm({ ...sortingForm, workerId: value })} options={data.workers.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))} />
                <SelectField label="顧問先" value={sortingForm.clientId} onChange={(value) => setSortingForm({ ...sortingForm, clientId: value })} options={data.clients.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))} />
                <SortingCountField label="総仕訳数" value={sortingCountState.inputs.totalSortingCount} onChange={(value) => updateSortingCount("totalSortingCount", value)} auto={sortingCountState.autoField === "totalSortingCount"} help={<SortingCountSummary previousTotal={previousTotalSortingCount} currentTotal={sortingForm.totalSortingCount} />} />
                <SortingCountField label="手入力件数" value={sortingCountState.inputs.manualCount} onChange={(value) => updateSortingCount("manualCount", value)} auto={sortingCountState.autoField === "manualCount"} />
                <SortingCountField label="スマート取込件数" value={sortingCountState.inputs.smartImportCount} onChange={(value) => updateSortingCount("smartImportCount", value)} auto={sortingCountState.autoField === "smartImportCount"} />
                {sortingCountState.warning ? <div className="lg:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{sortingCountState.warning}</div> : null}
                <MemoField value={sortingForm.memo} onChange={(value) => setSortingForm({ ...sortingForm, memo: value })} />
                <SubmitRow label={editingSorting ? "仕訳作業を更新" : "仕訳作業を保存"} />
              </form>
            ) : (
              <form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={submitMonthly}>
                <DateField value={monthlyForm.workDate} onChange={(value) => setMonthlyForm({ ...monthlyForm, workDate: value })} />
                <SelectField label="担当者" value={monthlyForm.workerId} onChange={(value) => setMonthlyForm({ ...monthlyForm, workerId: value })} options={data.workers.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))} />
                <SelectField label="顧問先" value={monthlyForm.clientId} onChange={(value) => setMonthlyForm({ ...monthlyForm, clientId: value })} options={data.clients.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))} />
                {workKind === "submitted-documents" ? <NumberField label="書類数" value={monthlyForm.documentCount} onChange={(value) => setMonthlyForm({ ...monthlyForm, documentCount: value })} /> : <NumberField label="作業時間（分）" value={monthlyForm.workMinutes} onChange={(value) => setMonthlyForm({ ...monthlyForm, workMinutes: value })} />}
                <MemoField value={monthlyForm.memo} onChange={(value) => setMonthlyForm({ ...monthlyForm, memo: value })} />
                <SubmitRow label={editingMonthly ? "月次作業を更新" : "月次作業を保存"} />
              </form>
            )}
          </section>
        ) : null}

        {mainTab === "summary" ? (
          <section className="space-y-6">
            <MonthHeader title="月次集計" description="仕訳作業と月次作業の集計を確認します。" month={month} setMonth={setMonth} action={<div className="flex flex-wrap gap-2"><button className="button-secondary" onClick={() => exportCsv(() => downloadMonthlyCsv(month, sortingSummary.rows, sortingSummary.clientRows))}>仕訳月次集計CSV出力</button><button className="button-primary" onClick={() => exportCsv(() => downloadMonthlyWorkSummaryCsv(month, monthlySummary.rows))}>月次作業集計CSV出力</button></div>} />
            <SummaryCards sortingSummary={sortingSummary} monthlySummary={monthlySummary} />
            <SortingSummaryTable rows={sortingSummary.clientRows} />
            <MonthlySummaryTable rows={monthlySummary.rows} />
          </section>
        ) : null}

        {mainTab === "outsource" ? (
          <section className="space-y-6">
            <MonthHeader title="外注費支払" description="対象月の担当者別支払額と明細を確認します。" month={month} setMonth={setMonth} action={<div className="flex flex-wrap gap-2"><button className="button-secondary" onClick={() => exportCsv(() => downloadOutsourcePaymentSummaryCsv(month, outsourceSummary.rows))}>外注費支払一覧CSV出力</button><button className="button-secondary" onClick={() => exportCsv(() => downloadOutsourcePaymentDetailCsv(month, outsourceSummary.rows))}>外注費支払明細CSV出力</button></div>} />
            <OutsourcePaymentTable rows={outsourceSummary.rows} selectedWorkerId={selectedOutsourceWorkerId} setSelectedWorkerId={setSelectedOutsourceWorkerId} onPrint={printPaymentStatement} />
          </section>
        ) : null}

        {mainTab === "more" ? (
          <section className="space-y-6">
            <div className="panel p-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <ChoiceButton active={moreTab === "home"} onClick={() => setMoreTab("home")} label="ホーム" />
                <ChoiceButton active={moreTab === "list"} onClick={() => setMoreTab("list")} label="作業一覧" />
                <ChoiceButton active={moreTab === "billing"} onClick={() => setMoreTab("billing")} label="顧問先別請求・採算" />
                <ChoiceButton active={moreTab === "backup"} onClick={() => setMoreTab("backup")} label="バックアップ管理" />
                <ChoiceButton active={moreTab === "settings"} onClick={() => setMoreTab("settings")} label="設定" />
              </div>
            </div>
            {moreTab === "home" ? <HomePanel month={month} setMonth={setMonth} profitability={profitability} sortingSummary={sortingSummary} monthlySummary={monthlySummary} rows={allWork.slice(0, 8)} /> : null}
            {moreTab === "list" ? <WorkListPanel month={month} setMonth={setMonth} data={data} workers={workers} clients={clients} workTypes={workTypes} monthlySortingReports={monthlySortingReports} monthlySummary={monthlySummary} editSorting={editSorting} editMonthly={editMonthly} removeSorting={(id) => deleteReport(id, data).then(setData)} removeMonthly={(id) => deleteMonthlyWorkReport(id, data).then(setData)} exportCsv={exportCsv} /> : null}
            {moreTab === "billing" ? <BillingPanel month={month} setMonth={setMonth} rows={clientProfitability} exportCsv={() => exportCsv(() => downloadClientBillingCsv(month, clientProfitability))} /> : null}
            {moreTab === "backup" ? (
              <BackupSettingsPanel
                data={data}
                month={month}
                recentLocalBackups={recentLocalBackups}
                backupPreview={backupPreview}
                exportBackup={exportBackup}
                exportBackupCsv={exportBackupCsv}
                previewBackupFile={previewBackupFile}
              />
            ) : null}
            {moreTab === "settings" ? (
              <SettingsPanel
                settingsTab={settingsTab}
                setSettingsTab={setSettingsTab}
                data={data}
                clientForm={clientForm}
                setClientForm={setClientForm}
                submitClient={submitClient}
                removeClient={(id) => deleteClient(id, data).then(setData)}
                workerForm={workerForm}
                setWorkerForm={setWorkerForm}
                submitWorker={submitWorker}
                removeWorker={(id) => deleteWorker(id, data).then(setData)}
                issueShareLink={issueShareLink}
                toggleShareLink={toggleShareLink}
                copyShareLink={copyShareLink}
                priceForms={priceForms}
                sortingPriceForms={sortingPriceForms}
                outsourcePriceForms={outsourcePriceForms}
                setPriceForms={setPriceForms}
                setSortingPriceForms={setSortingPriceForms}
                setOutsourcePriceForms={setOutsourcePriceForms}
                submitPrice={submitPrice}
                submitSortingPrice={submitSortingPrice}
                submitOutsourcePrice={submitOutsourcePrice}
                paymentSettingsForm={paymentSettingsForm}
                setPaymentSettingsForm={setPaymentSettingsForm}
                submitPaymentSettings={submitPaymentSettings}
                month={month}
                recentLocalBackups={recentLocalBackups}
                backupPreview={backupPreview}
                exportBackup={exportBackup}
                exportBackupCsv={exportBackupCsv}
                previewBackupFile={previewBackupFile}
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function MainButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button className={`rounded-md px-3 py-3 text-sm font-bold transition ${active ? "bg-ink text-white" : "border border-line bg-white text-slate-700 hover:bg-slate-50"}`} onClick={onClick}>{label}</button>;
}

function ChoiceButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`rounded-md px-4 py-2 text-sm font-semibold ${active ? "bg-ink text-white" : "border border-line bg-white text-slate-700 hover:bg-slate-50"}`} onClick={onClick}>{label}</button>;
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "brand" | "accent" }) {
  const toneClass = tone === "brand" ? "text-brand" : tone === "accent" ? "text-accent" : "text-ink";
  return <div className="panel p-5"><div className="text-sm font-semibold text-slate-500">{label}</div><div className={`mt-2 text-3xl font-bold ${toneClass}`}>{value}</div></div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={className}><span className="label mb-1 block">{label}</span>{children}</label>;
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="作業日"><input className="field" type="date" required value={value} onChange={(event) => onChange(event.target.value)} /><span className="mt-1 block text-xs text-slate-500">作業月: {monthFromDate(value)}</span></Field>;
}

function NumberField({ label, value, onChange, help }: { label: string; value: number; onChange: (value: number) => void; help?: string }) {
  return <Field label={label}><input className="field" type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value))} />{help ? <span className="mt-1 block text-xs text-slate-500">{help}</span> : null}</Field>;
}

function SortingCountField({ label, value, onChange, auto, help }: { label: string; value: string; onChange: (value: string) => void; auto: boolean; help?: React.ReactNode }) {
  return (
    <Field label={label}>
      <input className={`field ${auto ? "border-blue-300 bg-blue-50" : ""}`} type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} />
      {auto && value !== "" ? <span className="mt-1 block text-xs font-semibold text-blue-700">{formatNumber(Number(value))}件（自動計算）</span> : null}
      {help ? <span className="mt-1 block text-xs text-slate-500">{help}</span> : null}
    </Field>
  );
}

function SortingCountSummary({ previousTotal, currentTotal }: { previousTotal?: number; currentTotal: number }) {
  if (previousTotal === undefined) {
    return <>前回総仕訳数：0件（初回） ／ 今回作業件数：{formatNumber(currentTotal)}件</>;
  }
  const workCount = currentTotal - previousTotal;
  return <>前回総仕訳数：{formatNumber(previousTotal)}件 ／ 今回作業件数：{formatNumber(workCount)}件</>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><input className="field" value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <Field label={label}><select className="field" required value={value} onChange={(event) => onChange(event.target.value)}><option value="">選択してください</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>;
}

function MemoField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="メモ" className="lg:col-span-2"><textarea className="field min-h-28" value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function SubmitRow({ label }: { label: string }) {
  return <div className="lg:col-span-2"><button className="button-primary" type="submit">{label}</button></div>;
}

function MonthHeader({ title, description, month, setMonth, action }: { title: string; description: string; month: string; setMonth: (month: string) => void; action?: React.ReactNode }) {
  return <div className="panel p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold">{title}</h2><p className="text-sm text-slate-500">{description}</p></div><div className="flex flex-col gap-2 sm:flex-row sm:items-end"><Field label="対象月"><input className="field" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>{action}</div></div></div>;
}

function PanelTitle({ title, description }: { title: string; description?: string }) {
  return <div className="border-b border-line px-5 py-4"><h2 className="text-xl font-bold">{title}</h2>{description ? <p className="text-sm text-slate-500">{description}</p> : null}</div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-line bg-slate-50 px-3 py-2"><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-1 font-bold">{value}</div></div>;
}

function reportSourceLabel(source: "admin" | "worker_link", sourceWorkerId: string, workers: Map<string, string>) {
  if (source === "worker_link") return `外注者リンク入力（${workers.get(sourceWorkerId) ?? "担当者不明"}）`;
  return "管理者入力";
}

function Empty({ text }: { text: string }) {
  return <div className="panel p-6 text-sm text-slate-500">{text}</div>;
}

// The remaining presentation helpers are compact table components.
function HomePanel({ month, setMonth, profitability, sortingSummary, monthlySummary, rows }: { month: string; setMonth: (month: string) => void; profitability: { revenue: number; outsourceCost: number; grossProfit: number; grossProfitRate: number }; sortingSummary: ReturnType<typeof buildMonthlySummary>; monthlySummary: ReturnType<typeof buildMonthlyWorkSummary>; rows: { id: string; date: string; kind: string; client: string; worker: string; memo: string }[] }) {
  return <section className="space-y-6"><MonthHeader title="ホーム" description="当月の概要だけを表示します。" month={month} setMonth={setMonth} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="当月売上" value={formatCurrency(profitability.revenue)} tone="brand" /><Stat label="当月外注費" value={formatCurrency(profitability.outsourceCost)} /><Stat label="当月粗利" value={formatCurrency(profitability.grossProfit)} tone="accent" /><Stat label="当月粗利率" value={formatPercent(profitability.grossProfitRate)} tone="brand" /><Stat label="仕訳日報件数" value={`${formatNumber(sortingSummary.reports.length)}件`} /><Stat label="月次作業日報件数" value={`${formatNumber(monthlySummary.reports.length)}件`} /></div><section className="panel overflow-hidden"><PanelTitle title="最近の作業" /><SimpleWorkTable rows={rows} /></section></section>;
}

function SimpleWorkTable({ rows }: { rows: { id: string; date: string; kind: string; client: string; worker: string; memo: string }[] }) {
  if (!rows.length) return <Empty text="最近の作業がありません。" />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">作業日</th><th className="px-4 py-3">区分</th><th className="px-4 py-3">顧問先</th><th className="px-4 py-3">担当者</th><th className="px-4 py-3">メモ</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.kind}-${row.id}`}><td className="table-cell font-semibold">{row.date}</td><td className="table-cell">{row.kind}</td><td className="table-cell">{row.client}</td><td className="table-cell">{row.worker}</td><td className="table-cell">{row.memo}</td></tr>)}</tbody></table></div>;
}

function WorkListPanel(props: { month: string; setMonth: (month: string) => void; data: AppData; workers: Map<string, string>; clients: Map<string, string>; workTypes: Map<string, WorkType>; monthlySortingReports: DailyReport[]; monthlySummary: ReturnType<typeof buildMonthlyWorkSummary>; editSorting: (report: DailyReport) => void; editMonthly: (report: MonthlyWorkReport) => void; removeSorting: (id: string) => void; removeMonthly: (id: string) => void; exportCsv: (action: () => void) => void }) {
  return <section className="space-y-6"><MonthHeader title="作業一覧" description="仕訳作業と月次作業を確認できます。" month={props.month} setMonth={props.setMonth} action={<div className="flex flex-wrap gap-2"><button className="button-secondary" onClick={() => props.exportCsv(() => downloadSortingDailyReportCsv(props.month, props.monthlySortingReports, props.data))}>仕訳日報CSV出力</button><button className="button-secondary" onClick={() => props.exportCsv(() => downloadMonthlyWorkReportCsv(props.month, props.monthlySummary.reports, props.data))}>月次作業日報CSV出力</button></div>} /><section className="panel overflow-hidden"><PanelTitle title="仕訳作業" /><ReportTable reports={props.data.reports} data={props.data} workers={props.workers} clients={props.clients} onEdit={props.editSorting} onDelete={props.removeSorting} /></section><section className="panel overflow-hidden"><PanelTitle title="月次作業" /><MonthlyWorkTable reports={props.data.monthlyWorkReports} workers={props.workers} clients={props.clients} workTypes={props.workTypes} onEdit={props.editMonthly} onDelete={props.removeMonthly} /></section></section>;
}

function ReportTable({ reports, data, workers, clients, onEdit, onDelete }: { reports: DailyReport[]; data: AppData; workers: Map<string, string>; clients: Map<string, string>; onEdit: (report: DailyReport) => void; onDelete: (id: string) => void }) {
  if (!reports.length) return <Empty text="仕訳作業がありません。" />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1080px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">作業日</th><th className="px-4 py-3">担当者</th><th className="px-4 py-3">顧問先</th><th className="px-4 py-3 text-right">手入力</th><th className="px-4 py-3 text-right">スマート取込</th><th className="px-4 py-3 text-right">総仕分け数</th><th className="px-4 py-3 text-right">作業件数</th><th className="px-4 py-3">登録元</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td className="table-cell font-semibold">{report.workDate}</td><td className="table-cell">{workers.get(report.workerId) ?? "未設定"}</td><td className="table-cell">{clients.get(report.clientId) ?? "未設定"}</td><td className="table-cell text-right">{formatNumber(report.manualCount)}</td><td className="table-cell text-right">{formatNumber(report.smartImportCount)}</td><td className="table-cell text-right">{formatNumber(report.totalSortingCount)}</td><td className="table-cell text-right">{formatNumber(calculateAutoWorkCount(data.reports, report))}</td><td className="table-cell">{reportSourceLabel(report.source, report.sourceWorkerId, workers)}</td><td className="table-cell text-right"><button className="button-secondary mr-2" onClick={() => onEdit(report)}>編集</button><button className="button-danger" onClick={() => onDelete(report.id)}>削除</button></td></tr>)}</tbody></table></div>;
}

function MonthlyWorkTable({ reports, workers, clients, workTypes, onEdit, onDelete }: { reports: MonthlyWorkReport[]; workers: Map<string, string>; clients: Map<string, string>; workTypes: Map<string, WorkType>; onEdit: (report: MonthlyWorkReport) => void; onDelete: (id: string) => void }) {
  if (!reports.length) return <Empty text="月次作業がありません。" />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1020px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">作業日</th><th className="px-4 py-3">担当者</th><th className="px-4 py-3">顧問先</th><th className="px-4 py-3">作業区分</th><th className="px-4 py-3 text-right">数量</th><th className="px-4 py-3">登録元</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td className="table-cell font-semibold">{report.workDate}</td><td className="table-cell">{workers.get(report.workerId) ?? "未設定"}</td><td className="table-cell">{clients.get(report.clientId) ?? "未設定"}</td><td className="table-cell">{workTypes.get(report.workTypeId)?.name ?? "未設定"}</td><td className="table-cell text-right">{report.workTypeId === "submitted-documents" ? `${formatNumber(report.documentCount)}件` : formatMinutes(report.workMinutes)}</td><td className="table-cell">{reportSourceLabel(report.source, report.sourceWorkerId, workers)}</td><td className="table-cell text-right"><button className="button-secondary mr-2" onClick={() => onEdit(report)}>編集</button><button className="button-danger" onClick={() => onDelete(report.id)}>削除</button></td></tr>)}</tbody></table></div>;
}

function SummaryCards({ sortingSummary, monthlySummary }: { sortingSummary: ReturnType<typeof buildMonthlySummary>; monthlySummary: ReturnType<typeof buildMonthlyWorkSummary> }) {
  const sortingRevenue = sortingSummary.clientRows.reduce((sum, row) => sum + row.sortingRevenue, 0);
  const sortingCost = sortingSummary.clientRows.reduce((sum, row) => sum + row.sortingOutsourceCost, 0);
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="仕訳売上" value={formatCurrency(sortingRevenue)} /><Stat label="仕訳外注費" value={formatCurrency(sortingCost)} /><Stat label="月次作業売上" value={formatCurrency(monthlySummary.totals.revenue)} /><Stat label="月次作業原価" value={formatCurrency(monthlySummary.totals.cost)} /></div>;
}

function SortingSummaryTable({ rows }: { rows: ReturnType<typeof buildMonthlySummary>["clientRows"] }) {
  if (!rows.length) return <Empty text="仕訳集計がありません。" />;
  return <section className="panel overflow-hidden"><PanelTitle title="仕訳日報集計" /><div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">顧問先</th><th className="px-4 py-3 text-right">手入力実件数</th><th className="px-4 py-3 text-right">手入力請求対象</th><th className="px-4 py-3 text-right">スマート取込</th><th className="px-4 py-3 text-right">売上</th><th className="px-4 py-3 text-right">外注費</th><th className="px-4 py-3 text-right">粗利</th></tr></thead><tbody>{rows.map((row) => <tr key={row.clientId}><td className="table-cell font-semibold">{row.clientName}</td><td className="table-cell text-right">{formatNumber(row.manualCount)}</td><td className="table-cell text-right">{formatNumber(row.manualBillableCount)}</td><td className="table-cell text-right">{formatNumber(row.smartImportCount)}</td><td className="table-cell text-right">{formatCurrency(row.sortingRevenue)}</td><td className="table-cell text-right">{formatCurrency(row.sortingOutsourceCost)}</td><td className="table-cell text-right font-bold text-brand">{formatCurrency(row.sortingRevenue - row.sortingOutsourceCost)}</td></tr>)}</tbody></table></div></section>;
}

function MonthlySummaryTable({ rows }: { rows: ReturnType<typeof buildMonthlyWorkSummary>["rows"] }) {
  if (!rows.length) return <Empty text="月次作業集計がありません。" />;
  return <section className="panel overflow-hidden"><PanelTitle title="月次作業集計" /><div className="overflow-x-auto"><table className="w-full min-w-[880px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">顧問先</th><th className="px-4 py-3">作業区分</th><th className="px-4 py-3 text-right">数量</th><th className="px-4 py-3 text-right">売上</th><th className="px-4 py-3 text-right">原価</th><th className="px-4 py-3 text-right">粗利</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><td className="table-cell font-semibold">{row.clientName}</td><td className="table-cell">{row.workTypeName}</td><td className="table-cell text-right">{row.unit === "count" ? `${formatNumber(row.documentCount)}件` : formatMinutes(row.workMinutes)}</td><td className="table-cell text-right">{formatCurrency(row.revenue)}</td><td className="table-cell text-right">{formatCurrency(row.cost)}</td><td className="table-cell text-right font-bold text-brand">{formatCurrency(row.grossProfit)}</td></tr>)}</tbody></table></div></section>;
}

function BillingPanel({ month, setMonth, rows, exportCsv }: { month: string; setMonth: (month: string) => void; rows: ReturnType<typeof buildClientProfitability>; exportCsv: () => void }) {
  return <section className="space-y-6"><MonthHeader title="顧問先別請求・採算" description="売上、外注費、粗利、粗利率を顧問先別に確認します。" month={month} setMonth={setMonth} action={<button className="button-primary" onClick={exportCsv}>顧問先別請求・採算CSV出力</button>} /><BillingTable rows={rows} /></section>;
}

function BillingTable({ rows }: { rows: ReturnType<typeof buildClientProfitability> }) {
  if (!rows.length) return <Empty text="請求・採算データがありません。" />;
  return <div className="space-y-4">{rows.map((row) => <section key={row.clientId} className="panel overflow-hidden"><PanelTitle title={row.clientName} description={`粗利: ${formatCurrency(row.grossProfit)} / 粗利率: ${formatPercent(row.grossProfitRate)}`} /><div className="overflow-x-auto"><table className="w-full min-w-[1120px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">顧問先</th><th className="px-4 py-3 text-right">仕訳日報売上</th><th className="px-4 py-3 text-right">提出書類売上</th><th className="px-4 py-3 text-right">その他事務業務売上</th><th className="px-4 py-3 text-right">売上合計</th><th className="px-4 py-3 text-right">外注費合計</th><th className="px-4 py-3 text-right">粗利</th><th className="px-4 py-3 text-right">粗利率</th></tr></thead><tbody><tr><td className="table-cell font-semibold">{row.clientName}</td><td className="table-cell text-right">{formatCurrency(row.sortingRevenue)}</td><td className="table-cell text-right">{formatCurrency(row.submittedDocumentsRevenue)}</td><td className="table-cell text-right">{formatCurrency(row.officeWorkRevenue)}</td><td className="table-cell text-right font-bold text-brand">{formatCurrency(row.totalRevenue)}</td><td className="table-cell text-right">{formatCurrency(row.totalOutsourceCost)}</td><td className="table-cell text-right font-bold text-brand">{formatCurrency(row.grossProfit)}</td><td className="table-cell text-right">{formatPercent(row.grossProfitRate)}</td></tr></tbody></table></div><div className="border-t border-line p-5"><h3 className="font-bold">外注費内訳</h3><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Info label="手入力外注費" value={formatCurrency(row.manualOutsourceCost)} /><Info label="スマート取込外注費" value={formatCurrency(row.smartOutsourceCost)} /><Info label="提出書類外注費" value={formatCurrency(row.submittedDocumentsOutsourceCost)} /><Info label="その他事務業務外注費" value={formatCurrency(row.officeWorkOutsourceCost)} /></div></div>{row.sortingDetail ? <SortingDetail row={row.sortingDetail} /> : null}</section>)}</div>;
}

function SortingDetail({ row }: { row: ReturnType<typeof buildMonthlySummary>["clientRows"][number] }) {
  return <div className="border-t border-line p-5"><h3 className="font-bold">仕訳日報内訳</h3><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Info label="手入力実件数" value={`${formatNumber(row.manualCount)}件`} /><Info label="手入力請求対象件数" value={`${formatNumber(row.manualBillableCount)}件`} /><Info label="手入力売上単価" value={`1件あたり${formatNumber(row.manualRevenueUnitPrice)}円`} /><Info label="手入力売上" value={formatCurrency(row.manualRevenue)} /><Info label="手入力原価単価" value={`1件あたり${formatNumber(row.manualCostUnitPrice)}円`} /><Info label="手入力原価" value={formatCurrency(row.manualCost)} /><Info label="スマート取込件数" value={`${formatNumber(row.smartImportCount)}件`} /><Info label="スマート取込売上単価" value={`1件あたり${formatNumber(row.smartRevenueUnitPrice)}円`} /><Info label="スマート取込売上" value={formatCurrency(row.smartRevenue)} /><Info label="スマート取込原価単価" value={`1件あたり${formatNumber(row.smartCostUnitPrice)}円`} /><Info label="スマート取込原価" value={formatCurrency(row.smartCost)} /></div></div>;
}

function OutsourcePaymentTable({ rows, selectedWorkerId, setSelectedWorkerId, onPrint }: { rows: WorkerOutsourceSummaryRow[]; selectedWorkerId: string; setSelectedWorkerId: (id: string) => void; onPrint: (row: WorkerOutsourceSummaryRow) => void }) {
  if (!rows.length) return <Empty text="外注費支払データがありません。" />;
  const selected = rows.find((row) => row.workerId === selectedWorkerId) ?? rows[0];
  return <div className="space-y-4"><section className="panel overflow-hidden"><PanelTitle title="担当者別支払一覧" description="担当者行をクリックすると明細を表示します。" /><div className="overflow-x-auto"><table className="w-full min-w-[1120px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">担当者</th><th className="px-4 py-3 text-right">手入力件数</th><th className="px-4 py-3 text-right">手入力外注費</th><th className="px-4 py-3 text-right">スマート取込件数</th><th className="px-4 py-3 text-right">スマート取込外注費</th><th className="px-4 py-3 text-right">提出書類件数</th><th className="px-4 py-3 text-right">提出書類外注費</th><th className="px-4 py-3 text-right">その他事務業務時間</th><th className="px-4 py-3 text-right">その他事務業務外注費</th><th className="px-4 py-3 text-right">支払合計</th></tr></thead><tbody>{rows.map((row) => <tr key={row.workerId} className={`cursor-pointer hover:bg-slate-50 ${selected.workerId === row.workerId ? "bg-blue-50" : ""}`} onClick={() => setSelectedWorkerId(row.workerId)}><td className="table-cell font-semibold">{row.workerName}</td><td className="table-cell text-right">{formatNumber(row.manualCount)}</td><td className="table-cell text-right">{formatCurrency(row.manualAmount)}</td><td className="table-cell text-right">{formatNumber(row.smartImportCount)}</td><td className="table-cell text-right">{formatCurrency(row.smartImportAmount)}</td><td className="table-cell text-right">{formatNumber(row.submittedDocumentsCount)}</td><td className="table-cell text-right">{formatCurrency(row.submittedDocumentsAmount)}</td><td className="table-cell text-right">{formatMinutes(row.officeWorkMinutes)}</td><td className="table-cell text-right">{formatCurrency(row.officeWorkAmount)}</td><td className="table-cell text-right font-bold text-brand">{formatCurrency(row.totalAmount)}</td></tr>)}</tbody></table></div></section><section className="panel overflow-hidden"><PanelTitle title={`${selected.workerName}さんの明細`} description="PDF出力はブラウザの印刷画面で「PDFとして保存」を選んでください。" /><div className="border-b border-line px-5 py-4"><button className="button-primary" onClick={() => onPrint(selected)}>支払明細PDF出力</button></div><div className="overflow-x-auto"><table className="w-full min-w-[920px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">作業日</th><th className="px-4 py-3">顧問先</th><th className="px-4 py-3">作業区分</th><th className="px-4 py-3 text-right">数量</th><th className="px-4 py-3 text-right">単価</th><th className="px-4 py-3 text-right">外注費</th><th className="px-4 py-3">メモ</th></tr></thead><tbody>{selected.details.map((detail) => <tr key={detail.id}><td className="table-cell font-semibold">{detail.workDate}</td><td className="table-cell">{detail.clientName}</td><td className="table-cell">{detail.workKind}</td><td className="table-cell text-right">{detail.quantityLabel}</td><td className="table-cell text-right">{formatCurrency(detail.unitPrice)}</td><td className="table-cell text-right font-bold text-brand">{formatCurrency(detail.amount)}</td><td className="table-cell">{detail.memo}</td></tr>)}</tbody></table></div></section></div>;
}

function SettingsPanel(props: {
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  data: AppData;
  clientForm: Partial<Client> & Pick<Client, "name">;
  setClientForm: (form: Partial<Client> & Pick<Client, "name">) => void;
  submitClient: (event: FormEvent) => void;
  removeClient: (id: string) => void;
  workerForm: Partial<Worker> & Pick<Worker, "name">;
  setWorkerForm: (form: Partial<Worker> & Pick<Worker, "name">) => void;
  submitWorker: (event: FormEvent) => void;
  removeWorker: (id: string) => void;
  issueShareLink: (workerId: string) => void;
  toggleShareLink: (workerId: string, active: boolean) => void;
  copyShareLink: (token: string) => void;
  priceForms: Record<string, UnitPrice>;
  sortingPriceForms: Record<string, SortingUnitPrice>;
  outsourcePriceForms: Record<string, WorkerOutsourcePrice>;
  setPriceForms: (forms: Record<string, UnitPrice>) => void;
  setSortingPriceForms: (forms: Record<string, SortingUnitPrice>) => void;
  setOutsourcePriceForms: (forms: Record<string, WorkerOutsourcePrice>) => void;
  submitPrice: (event: FormEvent, price: UnitPrice) => void;
  submitSortingPrice: (event: FormEvent, price: SortingUnitPrice) => void;
  submitOutsourcePrice: (event: FormEvent, price: WorkerOutsourcePrice) => void;
  paymentSettingsForm: PaymentStatementSettings;
  setPaymentSettingsForm: (form: PaymentStatementSettings) => void;
  submitPaymentSettings: (event: FormEvent) => void;
  month: string;
  recentLocalBackups: RecentLocalBackup[];
  backupPreview: BackupPreview | null;
  exportBackup: (kind: BackupKind) => void;
  exportBackupCsv: (action: () => void) => void;
  previewBackupFile: (file?: File) => void;
}) {
  return (
    <section className="space-y-6">
      <div className="panel p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <ChoiceButton active={props.settingsTab === "clients"} onClick={() => props.setSettingsTab("clients")} label="顧問先設定" />
          <ChoiceButton active={props.settingsTab === "workers"} onClick={() => props.setSettingsTab("workers")} label="担当者設定" />
          <ChoiceButton active={props.settingsTab === "workTypes"} onClick={() => props.setSettingsTab("workTypes")} label="作業種別設定" />
          <ChoiceButton active={props.settingsTab === "prices"} onClick={() => props.setSettingsTab("prices")} label="単価設定" />
          <ChoiceButton active={props.settingsTab === "paymentStatement"} onClick={() => props.setSettingsTab("paymentStatement")} label="支払明細書設定" />
          <ChoiceButton active={props.settingsTab === "backup"} onClick={() => props.setSettingsTab("backup")} label="バックアップ管理" />
        </div>
      </div>
      {props.settingsTab === "clients" ? <ClientSettings data={props.data} form={props.clientForm} setForm={props.setClientForm} submit={props.submitClient} remove={props.removeClient} /> : null}
      {props.settingsTab === "workers" ? <WorkerSettings data={props.data} form={props.workerForm} setForm={props.setWorkerForm} submit={props.submitWorker} remove={props.removeWorker} issueShareLink={props.issueShareLink} toggleShareLink={props.toggleShareLink} copyShareLink={props.copyShareLink} /> : null}
      {props.settingsTab === "workTypes" ? <WorkTypeSettings workTypes={props.data.workTypes} /> : null}
      {props.settingsTab === "prices" ? <PriceSettings data={props.data} priceForms={props.priceForms} sortingPriceForms={props.sortingPriceForms} outsourcePriceForms={props.outsourcePriceForms} setPriceForms={props.setPriceForms} setSortingPriceForms={props.setSortingPriceForms} setOutsourcePriceForms={props.setOutsourcePriceForms} submitPrice={props.submitPrice} submitSortingPrice={props.submitSortingPrice} submitOutsourcePrice={props.submitOutsourcePrice} /> : null}
      {props.settingsTab === "paymentStatement" ? <PaymentStatementSettingsPanel form={props.paymentSettingsForm} setForm={props.setPaymentSettingsForm} submit={props.submitPaymentSettings} /> : null}
      {props.settingsTab === "backup" ? (
        <BackupSettingsPanel
          data={props.data}
          month={props.month}
          recentLocalBackups={props.recentLocalBackups}
          backupPreview={props.backupPreview}
          exportBackup={props.exportBackup}
          exportBackupCsv={props.exportBackupCsv}
          previewBackupFile={props.previewBackupFile}
        />
      ) : null}
    </section>
  );
}

function BackupSettingsPanel({
  data,
  month,
  recentLocalBackups,
  backupPreview,
  exportBackup,
  exportBackupCsv,
  previewBackupFile
}: {
  data: AppData;
  month: string;
  recentLocalBackups: RecentLocalBackup[];
  backupPreview: BackupPreview | null;
  exportBackup: (kind: BackupKind) => void;
  exportBackupCsv: (action: () => void) => void;
  previewBackupFile: (file?: File) => void;
}) {
  return (
    <section className="space-y-6">
      <section className="panel overflow-hidden">
        <PanelTitle title="バックアップ管理" description="デプロイ前や設定変更前に、現在のデータをJSONまたはCSVで保存できます。復元は自動実行しません。" />
        <div className="space-y-5 p-5">
          <div>
            <h3 className="font-bold">JSONバックアップ</h3>
            <p className="mt-1 text-sm text-slate-500">作業履歴、担当者、顧問先、単価、共有リンク、支払明細書設定を用途別に保存します。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-primary" type="button" onClick={() => exportBackup("all")}>全データをバックアップ</button>
              <button className="button-secondary" type="button" onClick={() => exportBackup("work_logs")}>作業履歴だけバックアップ</button>
              <button className="button-secondary" type="button" onClick={() => exportBackup("settings")}>設定だけバックアップ</button>
            </div>
          </div>
          <div>
            <h3 className="font-bold">CSVバックアップ（対象月: {month}）</h3>
            <p className="mt-1 text-sm text-slate-500">Excelで確認しやすいBOM付きUTF-8 CSVを出力します。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-secondary" type="button" onClick={() => exportBackupCsv(() => downloadSortingReportsBackupCsv(data, month))}>仕訳日報CSVバックアップ</button>
              <button className="button-secondary" type="button" onClick={() => exportBackupCsv(() => downloadMonthlyWorkReportsBackupCsv(data, month))}>月次作業日報CSVバックアップ</button>
              <button className="button-secondary" type="button" onClick={() => exportBackupCsv(() => downloadOutsourceDetailsBackupCsv(data, month))}>外注費支払明細CSVバックアップ</button>
              <button className="button-secondary" type="button" onClick={() => exportBackupCsv(() => downloadClientSummaryBackupCsv(data, month))}>顧問先別集計CSVバックアップ</button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <PanelTitle title="バックアップ内容確認" description="バックアップJSONを選択して、中身の件数だけ確認できます。ここでは復元や上書きは行いません。" />
        <div className="space-y-4 p-5">
          <input className="field" type="file" accept="application/json,.json" onChange={(event) => previewBackupFile(event.target.files?.[0])} />
          {backupPreview ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Info label="ファイル名" value={backupPreview.fileName} />
              <Info label="作成日時" value={backupPreview.backupCreatedAt || "未設定"} />
              <Info label="種別" value={backupPreview.backupType || "未設定"} />
              <Info label="スキーマ" value={backupPreview.backupSchemaVersion || "未設定"} />
              <Info label="仕訳日報" value={`${formatNumber(backupPreview.sortingReports)}件`} />
              <Info label="月次作業日報" value={`${formatNumber(backupPreview.monthlyWorkReports)}件`} />
              <Info label="顧問先" value={`${formatNumber(backupPreview.clients)}件`} />
              <Info label="担当者" value={`${formatNumber(backupPreview.workers)}件`} />
              <Info label="単価設定" value={`${formatNumber(backupPreview.unitPrices)}件`} />
              <Info label="担当者別外注単価" value={`${formatNumber(backupPreview.workerOutsourcePrices)}件`} />
              <Info label="共有リンク" value={`${formatNumber(backupPreview.workerShareLinks)}件`} />
              <Info label="支払明細書設定" value={backupPreview.hasPaymentStatementSettings ? "あり" : "なし"} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">まだバックアップJSONは選択されていません。</p>
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <PanelTitle title="ブラウザ内の直近バックアップ" description="作業入力を保存したタイミングで、このブラウザのlocalStorageに直近5世代まで控えを残します。" />
        <div className="p-5">
          {recentLocalBackups.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {recentLocalBackups.map((backup, index) => (
                <Info
                  key={`${backup.backup_created_at}-${index}`}
                  label={`${index + 1}世代前`}
                  value={`${new Date(backup.backup_created_at).toLocaleString("ja-JP")} / 担当者${formatNumber(backup.workers.length)}件 / 顧問先${formatNumber(backup.clients.length)}件`}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">このブラウザ内の直近バックアップはまだありません。作業入力を保存すると自動で作成されます。</p>
          )}
        </div>
      </section>
    </section>
  );
}

function ClientSettings({ data, form, setForm, submit, remove }: { data: AppData; form: Partial<Client> & Pick<Client, "name">; setForm: (form: Partial<Client> & Pick<Client, "name">) => void; submit: (event: FormEvent) => void; remove: (id: string) => void }) {
  return <section className="panel overflow-hidden"><PanelTitle title="顧問先設定" /><div className="border-b border-line p-5"><form className="grid gap-3 md:grid-cols-[160px_1fr_auto]" onSubmit={submit}><input className="field" placeholder="コード" value={form.code ?? ""} onChange={(event) => setForm({ ...form, code: event.target.value })} /><input className="field" placeholder="顧問先名" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><button className="button-primary" type="submit">保存</button></form></div><MasterRows rows={data.clients.map((client) => ({ id: client.id, name: `${client.code} ${client.name}`, status: client.active ? "有効" : "無効" }))} remove={remove} /></section>;
}

function WorkerSettings({
  data,
  form,
  setForm,
  submit,
  remove,
  issueShareLink,
  toggleShareLink,
  copyShareLink
}: {
  data: AppData;
  form: Partial<Worker> & Pick<Worker, "name">;
  setForm: (form: Partial<Worker> & Pick<Worker, "name">) => void;
  submit: (event: FormEvent) => void;
  remove: (id: string) => void;
  issueShareLink: (workerId: string) => void;
  toggleShareLink: (workerId: string, active: boolean) => void;
  copyShareLink: (token: string) => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <PanelTitle title="担当者設定" description="外注者用の共有リンクを担当者ごとに発行できます。" />
      <div className="border-b border-line p-5">
        <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={submit}>
          <input className="field" placeholder="担当者名" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <button className="button-primary" type="submit">保存</button>
        </form>
      </div>
      <div className="divide-y divide-line">
        {data.workers.map((worker) => {
          const link = data.workerShareLinks.find((item) => item.workerId === worker.id);
          const url = link ? `/worker/${link.token}` : "";
          return (
            <div key={worker.id} className="grid gap-3 p-5 lg:grid-cols-[180px_1fr_auto] lg:items-center">
              <div>
                <div className="font-bold">{worker.name}</div>
                <div className="text-xs text-slate-500">{worker.active ? "有効" : "無効"}</div>
              </div>
              <div>
                {link ? (
                  <>
                    <div className="break-all rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{url}</div>
                    <div className={`mt-1 text-xs font-semibold ${link.active ? "text-blue-700" : "text-slate-500"}`}>共有リンク: {link.active ? "有効" : "無効"}</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">共有リンクは未発行です。</div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="button-secondary" type="button" onClick={() => issueShareLink(worker.id)}>共有リンク発行</button>
                {link ? <button className="button-secondary" type="button" onClick={() => copyShareLink(link.token)}>コピー</button> : null}
                {link ? <button className={link.active ? "button-danger" : "button-secondary"} type="button" onClick={() => toggleShareLink(worker.id, !link.active)}>{link.active ? "無効化" : "有効化"}</button> : null}
                <button className="button-danger" type="button" onClick={() => remove(worker.id)}>削除</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MasterRows({ rows, remove }: { rows: { id: string; name: string; status: string }[]; remove: (id: string) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">名称</th><th className="px-4 py-3">状態</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="table-cell font-semibold">{row.name}</td><td className="table-cell">{row.status}</td><td className="table-cell text-right"><button className="button-danger" onClick={() => remove(row.id)}>削除</button></td></tr>)}</tbody></table></div>;
}

function WorkTypeSettings({ workTypes }: { workTypes: WorkType[] }) {
  return <section className="panel overflow-hidden"><PanelTitle title="作業種別設定" description="作業入力に表示する月次作業の区分です。" /><div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">作業種別</th><th className="px-4 py-3">集計単位</th><th className="px-4 py-3">状態</th></tr></thead><tbody>{workTypes.map((workType) => <tr key={workType.id}><td className="table-cell font-semibold">{workType.name}</td><td className="table-cell">{unitLabel(workType)}</td><td className="table-cell">{workType.active ? "有効" : "無効"}</td></tr>)}</tbody></table></div></section>;
}

function PaymentStatementSettingsPanel({ form, setForm, submit }: { form: PaymentStatementSettings; setForm: (form: PaymentStatementSettings) => void; submit: (event: FormEvent) => void }) {
  return <section className="panel p-5"><h2 className="text-xl font-bold">支払明細書設定</h2><form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={submit}><TextField label="PDFタイトル" value={form.title} onChange={(value) => setForm({ ...form, title: value })} /><TextField label="発行者名" value={form.issuerName} onChange={(value) => setForm({ ...form, issuerName: value })} /><TextField label="発行者住所" value={form.issuerAddress} onChange={(value) => setForm({ ...form, issuerAddress: value })} /><TextField label="発行者電話番号" value={form.issuerPhone} onChange={(value) => setForm({ ...form, issuerPhone: value })} /><TextField label="発行者メールアドレス" value={form.issuerEmail} onChange={(value) => setForm({ ...form, issuerEmail: value })} /><TextField label="登録番号または任意番号" value={form.registrationNumber} onChange={(value) => setForm({ ...form, registrationNumber: value })} /><TextField label="支払予定日文言" value={form.paymentDueText} onChange={(value) => setForm({ ...form, paymentDueText: value })} /><TextField label="振込手数料に関する文言" value={form.bankFeeText} onChange={(value) => setForm({ ...form, bankFeeText: value })} /><Field label="備考" className="lg:col-span-2"><textarea className="field min-h-24" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><Field label="フッター文言" className="lg:col-span-2"><textarea className="field min-h-20" value={form.footerText} onChange={(event) => setForm({ ...form, footerText: event.target.value })} /></Field><SubmitRow label="支払明細書設定を保存" /></form></section>;
}

function PriceSettings({ data, priceForms, sortingPriceForms, outsourcePriceForms, setPriceForms, setSortingPriceForms, setOutsourcePriceForms, submitPrice, submitSortingPrice, submitOutsourcePrice }: { data: AppData; priceForms: Record<string, UnitPrice>; sortingPriceForms: Record<string, SortingUnitPrice>; outsourcePriceForms: Record<string, WorkerOutsourcePrice>; setPriceForms: (forms: Record<string, UnitPrice>) => void; setSortingPriceForms: (forms: Record<string, SortingUnitPrice>) => void; setOutsourcePriceForms: (forms: Record<string, WorkerOutsourcePrice>) => void; submitPrice: (event: FormEvent, price: UnitPrice) => void; submitSortingPrice: (event: FormEvent, price: SortingUnitPrice) => void; submitOutsourcePrice: (event: FormEvent, price: WorkerOutsourcePrice) => void }) {
  return <section className="panel overflow-hidden"><PanelTitle title="単価設定" description="売上単価、原価単価、担当者別外注単価を編集できます。" /><div className="space-y-6 p-5"><div><h3 className="font-bold">売上・原価単価</h3><div className="mt-3 grid gap-4 lg:grid-cols-2">{data.sortingUnitPrices.map((price) => { const form = sortingPriceForms[price.id]; if (!form) return null; return <form key={price.id} className="rounded-lg border border-line p-4" onSubmit={(event) => submitSortingPrice(event, form)}><h4 className="font-bold">{form.name}</h4><div className="mt-4 grid gap-3 sm:grid-cols-2"><NumberField label="売上単価（円）" value={form.amount} onChange={(value) => setSortingPriceForms({ ...sortingPriceForms, [form.id]: { ...form, amount: value } })} /><NumberField label="原価単価（円）" value={form.costAmount} onChange={(value) => setSortingPriceForms({ ...sortingPriceForms, [form.id]: { ...form, costAmount: value } })} /></div><button className="button-primary mt-4" type="submit">保存</button></form>; })}{data.workTypes.map((workType) => { const form = priceForms[workType.id]; if (!form) return null; const unit = workType.unit === "count" ? "件" : "分"; return <form key={workType.id} className="rounded-lg border border-line p-4" onSubmit={(event) => submitPrice(event, form)}><h4 className="font-bold">{workType.name}</h4><div className="mt-4 grid gap-3 sm:grid-cols-3"><NumberField label="売上単価（円）" value={form.amount} onChange={(value) => setPriceForms({ ...priceForms, [workType.id]: { ...form, amount: value } })} /><NumberField label="原価単価（円）" value={form.costAmount} onChange={(value) => setPriceForms({ ...priceForms, [workType.id]: { ...form, costAmount: value } })} /><NumberField label={workType.unit === "count" ? "何件あたり" : "何分あたり"} value={form.quantity} onChange={(value) => setPriceForms({ ...priceForms, [workType.id]: { ...form, quantity: value, unitLabel: `${value}${unit}あたり` } })} /></div><button className="button-primary mt-4" type="submit">保存</button></form>; })}</div></div><div><h3 className="font-bold">担当者別外注単価</h3><div className="mt-3 grid gap-4 lg:grid-cols-2">{data.workers.map((worker) => { const form = outsourcePriceForms[worker.id]; if (!form) return null; return <form key={worker.id} className="rounded-lg border border-line p-4" onSubmit={(event) => submitOutsourcePrice(event, form)}><h4 className="font-bold">{worker.name}</h4><div className="mt-4 grid gap-3 sm:grid-cols-2"><NumberField label="手入力 外注単価（円/件）" value={form.manualUnitPrice} onChange={(value) => setOutsourcePriceForms({ ...outsourcePriceForms, [worker.id]: { ...form, manualUnitPrice: value } })} /><NumberField label="スマート取込 外注単価（円/件）" value={form.smartUnitPrice} onChange={(value) => setOutsourcePriceForms({ ...outsourcePriceForms, [worker.id]: { ...form, smartUnitPrice: value } })} /><NumberField label="提出書類 外注単価（円/件）" value={form.submittedDocumentsUnitPrice} onChange={(value) => setOutsourcePriceForms({ ...outsourcePriceForms, [worker.id]: { ...form, submittedDocumentsUnitPrice: value } })} /><NumberField label="その他事務業務 外注単価（円/10分）" value={form.officeWorkUnitPrice} onChange={(value) => setOutsourcePriceForms({ ...outsourcePriceForms, [worker.id]: { ...form, officeWorkUnitPrice: value } })} /></div><button className="button-primary mt-4" type="submit">保存</button></form>; })}</div></div></div></section>;
}
