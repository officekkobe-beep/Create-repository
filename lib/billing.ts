// 顧問先別の請求単価（売上単価）の決定と、日報行への単価の記録（スナップショット）を扱う。
//
// 単価の優先順（AI Council #176 承認仕様）:
//   1. 管理者が当該日報に指定した「今回限り」の単価
//   2. 顧問先×作業種別の個別単価
//   3. 作業種別の標準単価（unit_prices.amount）
// 0円は有効な単価として扱い、未設定（行なし）と区別する。
//
// 外注費・仕訳作業（無料枠30件）・原価の計算には一切関与しない。
import type { AppData, BillingPriceSource, ClientWorkTypeBillingPrice, MonthlyWorkReport, WorkType } from "./types";

export const DEFAULT_TIME_UNIT_MINUTES = 10;
export const ALLOWED_TIME_UNIT_MINUTES = [10, 15, 30, 60] as const;

export type ResolvedBillingPrice = {
  unitPrice: number;
  // 件数単価なら1、時間単価なら単価あたりの分数（10分・30分など）。
  unitQuantity: number;
  source: BillingPriceSource;
};

export function billingSourceLabel(source: BillingPriceSource) {
  if (source === "override") return "今回限りの単価";
  if (source === "client") return "顧問先別単価";
  return "標準単価";
}

export function billingUnitLabel(unit: WorkType["unit"], unitQuantity: number) {
  if (unit === "count") return "1件あたり";
  if (unitQuantity % 60 === 0) return unitQuantity === 60 ? "1時間あたり" : `${unitQuantity / 60}時間あたり`;
  return `${unitQuantity}分あたり`;
}

// 作業種別の標準単価の単位。時間単価は作業種別ごとに分数を持てる（未設定なら既存どおり10分）。
export function standardBillingUnitQuantity(workType: Pick<WorkType, "unit" | "billingUnitMinutes">) {
  if (workType.unit === "count") return 1;
  return workType.billingUnitMinutes && workType.billingUnitMinutes > 0 ? workType.billingUnitMinutes : DEFAULT_TIME_UNIT_MINUTES;
}

export function findClientBillingPrice(data: Pick<AppData, "clientWorkTypeBillingPrices">, clientId: string, workTypeId: string): ClientWorkTypeBillingPrice | undefined {
  return (data.clientWorkTypeBillingPrices ?? []).find((item) => item.clientId === clientId && item.workTypeId === workTypeId);
}

// 今回限りの単価を除いた「通常の」単価（顧問先別→標準）を決める。どちらも無ければnull。
function resolveBaseBillingPrice(data: AppData, clientId: string, workTypeId: string): ResolvedBillingPrice | null {
  const workType = data.workTypes.find((item) => item.id === workTypeId);
  if (!workType) return null;
  const clientPrice = findClientBillingPrice(data, clientId, workTypeId);
  if (clientPrice) {
    const unitQuantity = workType.unit === "count" ? 1 : clientPrice.unitMinutes && clientPrice.unitMinutes > 0 ? clientPrice.unitMinutes : standardBillingUnitQuantity(workType);
    return { unitPrice: clientPrice.unitPrice, unitQuantity, source: "client" };
  }
  const standard = data.unitPrices.find((item) => item.workTypeId === workTypeId);
  if (!standard) return null;
  return { unitPrice: standard.amount, unitQuantity: standardBillingUnitQuantity(workType), source: "standard" };
}

// 今回限りの単価は、通常単価の単位（件数／分数）をそのまま引き継ぐ。
export function resolveBillingPrice(data: AppData, clientId: string, workTypeId: string, overrideUnitPrice?: number | null): ResolvedBillingPrice | null {
  const base = resolveBaseBillingPrice(data, clientId, workTypeId);
  if (overrideUnitPrice === undefined || overrideUnitPrice === null) return base;
  const workType = data.workTypes.find((item) => item.id === workTypeId);
  if (!workType) return null;
  const unitQuantity = base?.unitQuantity ?? standardBillingUnitQuantity(workType);
  return { unitPrice: overrideUnitPrice, unitQuantity, source: "override" };
}

export function hasBillingSnapshot(report: Pick<MonthlyWorkReport, "billedUnitPrice" | "billedUnitQuantity">) {
  return typeof report.billedUnitPrice === "number" && typeof report.billedUnitQuantity === "number" && report.billedUnitQuantity > 0;
}

// 日報行に実際に適用される単価。単価が記録済みの行はその値を使い、マスタを変更しても金額が変わらない。
// 記録の無い旧データは、従来どおり「作業種別の標準単価・件数=1／時間=10分」で計算する（旧データは書き換えない）。
export function effectiveBillingPrice(report: Pick<MonthlyWorkReport, "workTypeId" | "billedUnitPrice" | "billedUnitQuantity" | "billedPriceSource">, data: AppData): ResolvedBillingPrice | null {
  if (hasBillingSnapshot(report)) {
    return { unitPrice: report.billedUnitPrice as number, unitQuantity: report.billedUnitQuantity as number, source: report.billedPriceSource ?? "standard" };
  }
  const workType = data.workTypes.find((item) => item.id === report.workTypeId);
  const standard = data.unitPrices.find((item) => item.workTypeId === report.workTypeId);
  if (!workType || !standard) return null;
  return { unitPrice: standard.amount, unitQuantity: workType.unit === "count" ? 1 : DEFAULT_TIME_UNIT_MINUTES, source: "standard" };
}

// 金額 = 数量 ÷ 単価の単位 × 単価。円未満は既存の計算と同じく四捨五入（Math.round）。
// 整数のまま掛けてから割ることで小数の誤差を避ける。
export function billingAmount(quantity: number, unitQuantity: number, unitPrice: number) {
  if (unitQuantity <= 0) return 0;
  return Math.round((quantity * unitPrice) / unitQuantity);
}

export type MonthlyBillingInput = {
  clientId: string;
  workTypeId: string;
  // undefined: 指定なし（既存行で顧問先・作業種別が変わらなければ記録済みの単価を維持）
  // null: 今回限りの単価を解除  number: 今回限りの単価を指定
  overrideUnitPrice?: number | null;
  overrideReason?: string;
};

export type MonthlyBillingSnapshot = {
  billedUnitPrice: number | null;
  billedUnitQuantity: number | null;
  billedPriceSource: BillingPriceSource | null;
  billingOverrideReason: string;
};

export class BillingPriceMissingError extends Error {
  constructor() {
    super("この顧問先・作業種別の売上単価が設定されていません。作業種別の標準単価または顧問先別単価を設定してください。");
  }
}

export function validateOverrideUnitPrice(value: number | null | undefined) {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0) throw new Error("今回限りの単価は0円以上の整数で入力してください。");
}

// 保存時に日報行へ記録する単価を決める。保存前の確認画面と実際の保存で同じ関数を使う。
export function planMonthlyBilling(input: MonthlyBillingInput, existing: MonthlyWorkReport | undefined, data: AppData): MonthlyBillingSnapshot {
  validateOverrideUnitPrice(input.overrideUnitPrice);
  const sameTarget = existing && existing.clientId === input.clientId && existing.workTypeId === input.workTypeId;

  if (input.overrideUnitPrice === undefined && existing && sameTarget) {
    // 顧問先・作業種別が変わらない修正（数量・メモ等）では、記録済みの単価をそのまま使う。
    // 旧データ（単価の記録なし）は記録なしのまま（自動で書き換えない）。
    return {
      billedUnitPrice: existing.billedUnitPrice ?? null,
      billedUnitQuantity: existing.billedUnitQuantity ?? null,
      billedPriceSource: existing.billedPriceSource ?? null,
      billingOverrideReason: existing.billingOverrideReason ?? ""
    };
  }

  // 顧問先・作業種別が変わった場合、以前の「今回限り」は引き継がない。
  const resolved = resolveBillingPrice(data, input.clientId, input.workTypeId, input.overrideUnitPrice ?? null);
  if (!resolved) throw new BillingPriceMissingError();
  return {
    billedUnitPrice: resolved.unitPrice,
    billedUnitQuantity: resolved.unitQuantity,
    billedPriceSource: resolved.source,
    billingOverrideReason: resolved.source === "override" ? (input.overrideReason ?? "").trim() : ""
  };
}
