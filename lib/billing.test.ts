import { describe, expect, it } from "vitest";
import { billingAmount, effectiveBillingPrice, planMonthlyBilling, resolveBillingPrice } from "./billing";
import { buildClientProfitability, buildMonthlyWorkSummary, buildOutsourcePaymentSummary, calculateMonthlyWorkAmount } from "./calculations";
import type { AppData, ClientWorkTypeBillingPrice, MonthlyWorkReport, UnitPrice, WorkType } from "./types";

const NOW = "2026-11-01T00:00:00.000Z";

function workType(id: string, unit: WorkType["unit"], billingUnitMinutes: number | null = null): WorkType {
  return { id, code: id, name: id, unit, billingUnitMinutes, active: true, createdAt: NOW };
}

function price(workTypeId: string, amount: number, outsourceAmount = 0): UnitPrice {
  return { workTypeId, amount, costAmount: 0, outsourceAmount, quantity: 1, unitLabel: "", createdAt: NOW, updatedAt: NOW };
}

function clientPrice(clientId: string, workTypeId: string, unitPrice: number, unitMinutes: number | null = null): ClientWorkTypeBillingPrice {
  return { id: `${clientId}-${workTypeId}`, clientId, workTypeId, unitPrice, unitMinutes, note: "", createdAt: NOW, updatedAt: NOW };
}

function report(overrides: Partial<MonthlyWorkReport>): MonthlyWorkReport {
  return {
    id: "m1",
    workDate: "2026-11-10",
    workMonth: "2026-11",
    workerId: "w1",
    workTypeId: "meeting",
    clientId: "c1",
    documentCount: 0,
    workMinutes: 0,
    memo: "",
    source: "admin",
    sourceWorkerId: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    workers: [{ id: "w1", code: "W001", name: "担当A", active: true, createdAt: NOW }],
    clients: [
      { id: "c1", name: "顧問先A", code: "C001", active: true, closingMonth: 3, createdAt: NOW },
      { id: "c2", name: "顧問先B", code: "C002", active: true, closingMonth: 3, createdAt: NOW }
    ],
    reports: [],
    workTypes: [workType("meeting", "time", 30), workType("board", "count"), workType("office", "time")],
    unitPrices: [price("meeting", 5000, 300), price("board", 30000, 1000), price("office", 500, 300)],
    sortingUnitPrices: [],
    workerOutsourcePrices: [],
    workerWorkTypeOutsourcePrices: [],
    clientWorkTypeBillingPrices: [],
    workerShareLinks: [],
    paymentStatementSettings: {
      title: "",
      issuerName: "",
      issuerAddress: "",
      issuerPhone: "",
      issuerEmail: "",
      registrationNumber: "",
      paymentDueText: "",
      bankFeeText: "",
      notes: "",
      footerText: "",
      updatedAt: NOW
    },
    monthlyWorkReports: [],
    monthlyClosings: [],
    backupRecords: [],
    auditLogs: [],
    ...overrides
  };
}

describe("AI Council #176 のテーブルテスト（端数は既存と同じ四捨五入）", () => {
  it.each([
    [20, 3333],
    [45, 7500],
    [60, 10000],
    [0, 0]
  ])("5,000円／30分で%i分 → %i円", (minutes, expected) => {
    expect(billingAmount(minutes, 30, 5000)).toBe(expected);
  });

  it.each([
    [1, 30000],
    [2, 60000],
    [0, 0]
  ])("30,000円／回で数量%i → %i円", (count, expected) => {
    expect(billingAmount(count, 1, 30000)).toBe(expected);
  });

  it("10分は1,667円（四捨五入。切捨てなら1,666円）", () => {
    expect(billingAmount(10, 30, 5000)).toBe(1667);
  });
});

describe("単価の優先順（今回限り＞顧問先別＞標準）", () => {
  it("顧問先別0円は有効な単価で、標準単価に戻らない", () => {
    const d = data({ clientWorkTypeBillingPrices: [clientPrice("c1", "meeting", 0, 30)] });
    expect(resolveBillingPrice(d, "c1", "meeting")).toEqual({ unitPrice: 0, unitQuantity: 30, source: "client" });
  });

  it("顧問先別が無ければ標準単価（作業種別の単位30分）を使う", () => {
    expect(resolveBillingPrice(data(), "c1", "meeting")).toEqual({ unitPrice: 5000, unitQuantity: 30, source: "standard" });
  });

  it("顧問先別単価は他の顧問先に影響しない", () => {
    const d = data({ clientWorkTypeBillingPrices: [clientPrice("c1", "board", 25000)] });
    expect(resolveBillingPrice(d, "c1", "board")?.unitPrice).toBe(25000);
    expect(resolveBillingPrice(d, "c2", "board")?.unitPrice).toBe(30000);
  });

  it("今回限りの単価が最優先で、単位は通常単価から引き継ぐ", () => {
    const d = data({ clientWorkTypeBillingPrices: [clientPrice("c1", "meeting", 4000, 60)] });
    expect(resolveBillingPrice(d, "c1", "meeting", 3000)).toEqual({ unitPrice: 3000, unitQuantity: 60, source: "override" });
    expect(resolveBillingPrice(d, "c1", "meeting", 0)).toEqual({ unitPrice: 0, unitQuantity: 60, source: "override" });
  });

  it("顧問先別も標準も無ければ保存できない", () => {
    const d = data({ unitPrices: [] });
    expect(resolveBillingPrice(d, "c1", "meeting")).toBeNull();
    expect(() => planMonthlyBilling({ clientId: "c1", workTypeId: "meeting" }, undefined, d)).toThrow("売上単価が設定されていません");
  });

  it("今回限りの単価に負数・小数は使えない", () => {
    expect(() => planMonthlyBilling({ clientId: "c1", workTypeId: "board", overrideUnitPrice: -1 }, undefined, data())).toThrow();
    expect(() => planMonthlyBilling({ clientId: "c1", workTypeId: "board", overrideUnitPrice: 10.5 }, undefined, data())).toThrow();
  });
});

describe("保存時の単価記録（スナップショット）", () => {
  it("新規保存では顧問先別単価が記録される", () => {
    const d = data({ clientWorkTypeBillingPrices: [clientPrice("c1", "board", 25000)] });
    expect(planMonthlyBilling({ clientId: "c1", workTypeId: "board" }, undefined, d)).toEqual({
      billedUnitPrice: 25000,
      billedUnitQuantity: 1,
      billedPriceSource: "client",
      billingOverrideReason: ""
    });
  });

  it("記録後にマスタ単価を変えても、保存済みの金額は変わらない", () => {
    const saved = report({ workTypeId: "board", documentCount: 1, billedUnitPrice: 25000, billedUnitQuantity: 1, billedPriceSource: "client" });
    const afterChange = data({ unitPrices: [price("meeting", 5000), price("board", 99999), price("office", 500)], clientWorkTypeBillingPrices: [clientPrice("c1", "board", 1)] });
    expect(calculateMonthlyWorkAmount(saved, afterChange)).toBe(25000);
  });

  it("メモ・数量だけの修正では記録済みの単価（今回限りを含む）を維持する", () => {
    const existing = report({ workTypeId: "board", documentCount: 1, billedUnitPrice: 20000, billedUnitQuantity: 1, billedPriceSource: "override", billingOverrideReason: "初回割引" });
    expect(planMonthlyBilling({ clientId: "c1", workTypeId: "board" }, existing, data())).toEqual({
      billedUnitPrice: 20000,
      billedUnitQuantity: 1,
      billedPriceSource: "override",
      billingOverrideReason: "初回割引"
    });
  });

  it("顧問先を変えると今回限りの単価は引き継がず、改めて単価を決める", () => {
    const existing = report({ workTypeId: "board", documentCount: 1, billedUnitPrice: 20000, billedUnitQuantity: 1, billedPriceSource: "override" });
    expect(planMonthlyBilling({ clientId: "c2", workTypeId: "board" }, existing, data()).billedPriceSource).toBe("standard");
  });

  it("今回限りの単価を解除（null）すると通常の単価に戻る", () => {
    const existing = report({ workTypeId: "board", documentCount: 1, billedUnitPrice: 20000, billedUnitQuantity: 1, billedPriceSource: "override" });
    expect(planMonthlyBilling({ clientId: "c1", workTypeId: "board", overrideUnitPrice: null }, existing, data())).toMatchObject({ billedUnitPrice: 30000, billedPriceSource: "standard" });
  });

  it("旧データ（単価の記録なし）は、メモ修正だけなら記録なしのまま", () => {
    const legacy = report({ workTypeId: "office", workMinutes: 30 });
    expect(planMonthlyBilling({ clientId: "c1", workTypeId: "office" }, legacy, data()).billedUnitPrice).toBeNull();
  });

  it("旧データは従来どおり「作業種別の標準単価・10分単位」で計算する", () => {
    const legacy = report({ workTypeId: "office", workMinutes: 25 });
    expect(effectiveBillingPrice(legacy, data())).toEqual({ unitPrice: 500, unitQuantity: 10, source: "standard" });
    expect(calculateMonthlyWorkAmount(legacy, data())).toBe(1250);
  });
});

describe("集計への反映", () => {
  it("旧データの集計結果は変わらない（10分単価・四捨五入・合計してから計算）", () => {
    const d = data({
      monthlyWorkReports: [report({ id: "a", workTypeId: "office", workMinutes: 5 }), report({ id: "b", workTypeId: "office", workMinutes: 5 })]
    });
    const summary = buildMonthlyWorkSummary(d, "2026-11");
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({ revenue: 500, revenueUnitPrice: 500, unitLabel: "10分あたり", priceSource: "standard", outsourceCost: 300 });
  });

  it("旧データと、同じ標準単価で記録した新しい行は1行にまとまる", () => {
    const d = data({
      monthlyWorkReports: [
        report({ id: "a", workTypeId: "office", workMinutes: 5 }),
        report({ id: "b", workTypeId: "office", workMinutes: 5, billedUnitPrice: 500, billedUnitQuantity: 10, billedPriceSource: "standard" })
      ]
    });
    const summary = buildMonthlyWorkSummary(d, "2026-11");
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].revenue).toBe(500);
  });

  it("顧問先別・今回限りの単価は別の行として集計し、売上に反映する", () => {
    const d = data({
      monthlyWorkReports: [
        report({ id: "a", workTypeId: "board", documentCount: 1, billedUnitPrice: 25000, billedUnitQuantity: 1, billedPriceSource: "client" }),
        report({ id: "b", workTypeId: "board", documentCount: 1, billedUnitPrice: 20000, billedUnitQuantity: 1, billedPriceSource: "override" }),
        report({ id: "c", workTypeId: "meeting", workMinutes: 45, billedUnitPrice: 5000, billedUnitQuantity: 30, billedPriceSource: "standard" })
      ]
    });
    const summary = buildMonthlyWorkSummary(d, "2026-11");
    expect(summary.rows.map((row) => [row.priceSource, row.revenue, row.unitLabel]).sort()).toEqual(
      [
        ["client", 25000, "1件あたり"],
        ["override", 20000, "1件あたり"],
        ["standard", 7500, "30分あたり"]
      ].sort()
    );
    expect(summary.totals.revenue).toBe(52500);
    const profitability = buildClientProfitability(d, "2026-11").find((row) => row.clientId === "c1");
    expect(profitability?.monthlyWorkRevenue).toBe(52500);
  });

  it("外注費は売上単価の単位（30分）に関係なく、従来どおり10分単位で計算する", () => {
    const d = data({
      monthlyWorkReports: [report({ id: "c", workTypeId: "meeting", workMinutes: 30, billedUnitPrice: 5000, billedUnitQuantity: 30, billedPriceSource: "client" })]
    });
    const summary = buildMonthlyWorkSummary(d, "2026-11");
    expect(summary.rows[0].outsourceCost).toBe(900);
    const outsource = buildOutsourcePaymentSummary(d, "2026-11");
    expect(outsource.rows[0].totalAmount).toBe(900);
  });
});
