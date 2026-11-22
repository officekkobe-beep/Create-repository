import { buildClientProfitability, buildMonthlySummary, buildMonthlyWorkSummary } from "../calculations";
import {
  closeMonth,
  deleteClient,
  deleteClientPermanently,
  deleteMonthlyWorkReport,
  deleteReport,
  deleteWorker,
  deleteWorkerPermanently,
  deleteWorkerWorkTypeOutsourcePrice,
  deleteWorkType,
  deleteWorkTypePermanently,
  issueWorkerShareLink,
  recordFullBackup,
  reopenMonth,
  toggleWorkerShareLink,
  updatePaymentStatementSettings,
  updateSortingUnitPrice,
  updateUnitPrice,
  updateWorkerOutsourcePrice,
  upsertClient,
  upsertMonthlyWorkReport,
  upsertReport,
  upsertWorker,
  upsertWorkerWorkTypeOutsourcePrice,
  upsertWorkTypeWithPrice
} from "../storage";
import type { AppData } from "../types";
import { parseMonthlyInput, parseSortingInput } from "./work-report-rules";

export class AdminCommandError extends Error {}

type Args = Record<string, unknown>;
type Context = { adminEmail: string };
type Handler = (args: Args, current: AppData, context: Context) => Promise<AppData>;

function object<T>(value: unknown, label: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AdminCommandError(`${label}の形式が正しくありません。`);
  return value as T;
}

function string(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new AdminCommandError(`${label}を指定してください。`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new AdminCommandError(`${label}の形式が正しくありません。`);
  return value;
}

function optionalId(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function assertWorker(current: AppData, workerId: string) {
  if (!current.workers.some((worker) => worker.id === workerId)) throw new AdminCommandError("担当者を選択してください。");
}

function assertClient(current: AppData, clientId: string) {
  if (!current.clients.some((client) => client.id === clientId)) throw new AdminCommandError("顧問先を選択してください。");
}

export function closingTotals(data: AppData, month: string) {
  const rows = buildClientProfitability(data, month);
  const salesTotal = rows.reduce((sum, row) => sum + row.totalRevenue, 0);
  const outsourceTotal = rows.reduce((sum, row) => sum + row.totalOutsourceCost, 0);
  const reportCount = buildMonthlySummary(data, month).reports.length + buildMonthlyWorkSummary(data, month).reports.length;
  return { salesTotal, outsourceTotal, grossProfit: salesTotal - outsourceTotal, reportCount };
}

// 1コマンド=1つの既存保存処理。テーブル名や検索条件を受け取る汎用プロキシにはしない。
const handlers: Record<string, Handler> = {
  "report.upsert": async (args, current) => {
    const parsed = parseSortingInput(args.input);
    if (!parsed.ok) throw new AdminCommandError(parsed.error);
    const input = object<Args>(args.input, "入力");
    const workerId = string(input.workerId, "担当者");
    assertWorker(current, workerId);
    assertClient(current, parsed.value.clientId);
    return upsertReport({ ...parsed.value, workerId, id: optionalId(input.id) }, current);
  },
  "report.delete": (args, current) => deleteReport(string(args.id, "日報ID"), current),
  "monthlyReport.upsert": async (args, current) => {
    const parsed = parseMonthlyInput(args.input);
    if (!parsed.ok) throw new AdminCommandError(parsed.error);
    const input = object<Args>(args.input, "入力");
    const workerId = string(input.workerId, "担当者");
    assertWorker(current, workerId);
    assertClient(current, parsed.value.clientId);
    const workType = current.workTypes.find((item) => item.id === parsed.value.workTypeId);
    if (!workType) throw new AdminCommandError("作業種別を選択してください。");
    if (workType.unit === "count" && parsed.value.documentCount <= 0) throw new AdminCommandError("数量を入力してください。");
    if (workType.unit === "time" && parsed.value.workMinutes <= 0) throw new AdminCommandError("作業時間（分）を入力してください。");
    return upsertMonthlyWorkReport(
      {
        ...parsed.value,
        workerId,
        documentCount: workType.unit === "count" ? parsed.value.documentCount : 0,
        workMinutes: workType.unit === "time" ? parsed.value.workMinutes : 0,
        id: optionalId(input.id)
      },
      current
    );
  },
  "monthlyReport.delete": (args, current) => deleteMonthlyWorkReport(string(args.id, "日報ID"), current),

  "worker.upsert": (args, current) => upsertWorker(object(args.worker, "担当者"), current),
  "worker.deactivate": (args, current) => deleteWorker(string(args.id, "担当者ID"), current),
  "worker.deletePermanently": (args, current) => deleteWorkerPermanently(string(args.id, "担当者ID"), current),
  "workerShareLink.issue": (args, current) => issueWorkerShareLink(string(args.workerId, "担当者ID"), current),
  "workerShareLink.toggle": (args, current) => toggleWorkerShareLink(string(args.workerId, "担当者ID"), boolean(args.active, "有効状態"), current),

  "client.upsert": (args, current) => upsertClient(object(args.client, "顧問先"), current),
  "client.deactivate": (args, current) => deleteClient(string(args.id, "顧問先ID"), current),
  "client.deletePermanently": (args, current) => deleteClientPermanently(string(args.id, "顧問先ID"), current),

  "workType.upsertWithPrice": (args, current) => upsertWorkTypeWithPrice(object(args.workType, "作業種別"), object(args.price, "単価"), current),
  "workType.deactivate": (args, current) => deleteWorkType(string(args.id, "作業種別ID"), current),
  "workType.deletePermanently": (args, current) => deleteWorkTypePermanently(string(args.id, "作業種別ID"), current),

  "unitPrice.update": (args, current) => updateUnitPrice(object(args.price, "単価"), current),
  "sortingUnitPrice.update": (args, current) => updateSortingUnitPrice(object(args.price, "単価"), current),
  "workerOutsourcePrice.update": (args, current) => updateWorkerOutsourcePrice(object(args.price, "外注単価"), current),
  "workerWorkTypeOutsourcePrice.upsert": (args, current) => upsertWorkerWorkTypeOutsourcePrice(object(args.price, "外注単価"), current),
  "workerWorkTypeOutsourcePrice.delete": (args, current) => deleteWorkerWorkTypeOutsourcePrice(string(args.id, "外注単価ID"), current),
  "paymentStatementSettings.update": (args, current) => updatePaymentStatementSettings(object(args.settings, "支払明細書設定"), current),

  "backup.recordFull": (args, current, context) =>
    recordFullBackup(string(args.targetMonth, "対象月"), string(args.fileName, "ファイル名"), current, context.adminEmail),
  // 確定時の売上・外注費は画面から受け取らず、サーバーで集計し直す。
  "month.close": (args, current, context) => {
    const month = string(args.targetMonth, "対象月");
    return closeMonth(month, current, closingTotals(current, month), optionalString(args.note), context.adminEmail);
  },
  "month.reopen": (args, current, context) => reopenMonth(string(args.targetMonth, "対象月"), optionalString(args.reason), current, context.adminEmail)
};

export const ADMIN_COMMANDS = Object.keys(handlers);

export async function runAdminCommand(command: string, args: unknown, current: AppData, context: Context) {
  const handler = Object.prototype.hasOwnProperty.call(handlers, command) ? handlers[command] : undefined;
  if (!handler) throw new AdminCommandError("この操作は利用できません。");
  return handler(object<Args>(args ?? {}, "引数"), current, context);
}
