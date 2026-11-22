import type {
  AppData,
  Client,
  DailyReport,
  MonthlyClosing,
  MonthlyWorkReport,
  MonthlyWorkReportInput,
  PaymentStatementSettings,
  ReportInput,
  SortingUnitPrice,
  UnitPrice,
  Worker,
  WorkerOutsourcePrice,
  WorkerWorkTypeOutsourcePrice,
  WorkType
} from "./types";

// 管理画面からの読み書きはすべてサーバーの管理者API経由で行う（ブラウザからDBへ直接アクセスしない）。
// 引数の current は従来の storage.ts と同じ呼び出し形を保つためだけに受け取り、サーバー側でDBの最新状態を使う。

type ApiResult = { ok?: boolean; data?: AppData; error?: string };

function redirectToLogin() {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") window.location.href = "/login";
}

async function readJson(response: Response): Promise<ApiResult> {
  return (await response.json().catch(() => ({}))) as ApiResult;
}

export async function fetchData(): Promise<{ data: AppData; mode: "supabase" | "local"; error?: string }> {
  try {
    const response = await fetch("/api/admin/data", { cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      throw new Error("ログインが必要です。");
    }
    const result = await readJson(response);
    if (!response.ok || !result.data) throw new Error(result.error ?? "データの読み込みに失敗しました。");
    return { data: result.data, mode: "supabase" };
  } catch (error) {
    return { data: emptyAppData(), mode: "local", error: error instanceof Error ? error.message : "データの読み込みに失敗しました。" };
  }
}

async function command(name: string, args: Record<string, unknown>): Promise<AppData> {
  const response = await fetch(`/api/admin/commands/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args })
  });
  if (response.status === 401) {
    redirectToLogin();
    throw new Error("ログインの有効期限が切れました。再度ログインしてください。");
  }
  const result = await readJson(response);
  if (!response.ok || !result.data) throw new Error(result.error ?? "保存に失敗しました。");
  return result.data;
}

export async function logout() {
  await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
  window.location.href = "/login";
}

export const upsertReport = (input: Partial<DailyReport> & ReportInput, _current: AppData) => command("report.upsert", { input });
export const deleteReport = (id: string, _current: AppData) => command("report.delete", { id });
export const upsertMonthlyWorkReport = (input: Partial<MonthlyWorkReport> & MonthlyWorkReportInput, _current: AppData) => command("monthlyReport.upsert", { input });
export const deleteMonthlyWorkReport = (id: string, _current: AppData) => command("monthlyReport.delete", { id });

export const upsertWorker = (worker: Partial<Worker> & Pick<Worker, "name">, _current: AppData) => command("worker.upsert", { worker });
export const deleteWorker = (id: string, _current: AppData) => command("worker.deactivate", { id });
export const deleteWorkerPermanently = (id: string, _current: AppData) => command("worker.deletePermanently", { id });
export const issueWorkerShareLink = (workerId: string, _current: AppData) => command("workerShareLink.issue", { workerId });
export const toggleWorkerShareLink = (workerId: string, active: boolean, _current: AppData) => command("workerShareLink.toggle", { workerId, active });

export const upsertClient = (client: Partial<Client> & Pick<Client, "name">, _current: AppData) => command("client.upsert", { client });
export const deleteClient = (id: string, _current: AppData) => command("client.deactivate", { id });
export const deleteClientPermanently = (id: string, _current: AppData) => command("client.deletePermanently", { id });

export const upsertWorkTypeWithPrice = (workType: Partial<WorkType> & Pick<WorkType, "name" | "unit">, price: Partial<UnitPrice>, _current: AppData) =>
  command("workType.upsertWithPrice", { workType, price });
export const deleteWorkType = (id: string, _current: AppData) => command("workType.deactivate", { id });
export const deleteWorkTypePermanently = (id: string, _current: AppData) => command("workType.deletePermanently", { id });

export const updateUnitPrice = (price: UnitPrice, _current: AppData) => command("unitPrice.update", { price });
export const updateSortingUnitPrice = (price: SortingUnitPrice, _current: AppData) => command("sortingUnitPrice.update", { price });
export const updateWorkerOutsourcePrice = (price: WorkerOutsourcePrice, _current: AppData) => command("workerOutsourcePrice.update", { price });
export const upsertWorkerWorkTypeOutsourcePrice = (
  price: Partial<WorkerWorkTypeOutsourcePrice> & Pick<WorkerWorkTypeOutsourcePrice, "workerId" | "workTypeId" | "outsourceUnitPrice">,
  _current: AppData
) => command("workerWorkTypeOutsourcePrice.upsert", { price });
export const deleteWorkerWorkTypeOutsourcePrice = (id: string, _current: AppData) => command("workerWorkTypeOutsourcePrice.delete", { id });
export const updatePaymentStatementSettings = (settings: PaymentStatementSettings, _current: AppData) => command("paymentStatementSettings.update", { settings });

export const recordFullBackup = (targetMonth: string, fileName: string, _current: AppData) => command("backup.recordFull", { targetMonth, fileName });
// 確定時の集計値はサーバーで再計算するため、画面から渡された totals は送らない。
export const closeMonth = (
  targetMonth: string,
  _current: AppData,
  _totals: Pick<MonthlyClosing, "salesTotal" | "outsourceTotal" | "grossProfit" | "reportCount">,
  note = ""
) => command("month.close", { targetMonth, note });
export const reopenMonth = (targetMonth: string, reason: string, _current: AppData) => command("month.reopen", { targetMonth, reason });

function emptyAppData(): AppData {
  return {
    workers: [],
    clients: [],
    reports: [],
    workTypes: [],
    unitPrices: [],
    sortingUnitPrices: [],
    workerOutsourcePrices: [],
    workerWorkTypeOutsourcePrices: [],
    workerShareLinks: [],
    paymentStatementSettings: {
      title: "支払明細書",
      issuerName: "",
      issuerAddress: "",
      issuerPhone: "",
      issuerEmail: "",
      registrationNumber: "",
      paymentDueText: "",
      bankFeeText: "",
      notes: "",
      footerText: "",
      updatedAt: ""
    },
    monthlyWorkReports: [],
    monthlyClosings: [],
    backupRecords: [],
    auditLogs: []
  };
}
