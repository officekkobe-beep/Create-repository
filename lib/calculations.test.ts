import { describe, expect, it } from "vitest";
import {
  buildMonthlyWorkSummary,
  calculateAutoWorkCount,
  calculateMonthlyWorkAmount,
  calculateSortingBillableCounts,
  findPreviousReport,
  FREE_MANUAL_ALLOWANCE,
  monthFromDate,
  resolveMonthlyOutsourceUnitPrice,
  unitPriceLabelFor,
  unitQuantityFor
} from "./calculations";
import { fiscalYearFromDate, fiscalStartMonth, normalizeClosingMonth } from "./fiscal-year";
import { calculateSortingCountState, emptySortingCountState, normalizeCountInput } from "./sorting-count";
import type { AppData, DailyReport, MonthlyWorkReport, UnitPrice, WorkType } from "./types";

const NOW = "2026-01-01T00:00:00.000Z";

function workType(id: string, unit: "count" | "time"): WorkType {
  return { id, code: id, name: id, unit, active: true, createdAt: NOW };
}

function unitPrice(workTypeId: string, amount: number, outsourceAmount: number, quantity = 1): UnitPrice {
  return { workTypeId, amount, costAmount: 0, outsourceAmount, quantity, unitLabel: "", createdAt: NOW, updatedAt: NOW };
}

function monthlyReport(overrides: Partial<MonthlyWorkReport>): MonthlyWorkReport {
  return {
    id: "m1",
    workDate: "2026-10-01",
    workMonth: "2026-10",
    workerId: "w1",
    workTypeId: "count-type",
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

function dailyReport(overrides: Partial<DailyReport>): DailyReport {
  return {
    id: "r1",
    workDate: "2026-10-01",
    workMonth: "2026-10",
    workerId: "w1",
    clientId: "c1",
    manualCount: 0,
    smartImportCount: 0,
    totalSortingCount: 0,
    memo: "",
    source: "admin",
    sourceWorkerId: "",
    fiscalYear: 2026,
    fiscalYearLabel: "2026年度",
    clientClosingMonth: 3,
    clientFiscalStartMonth: 4,
    previousTotalJournalCount: 0,
    currentTotalJournalCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function appData(overrides: Partial<AppData>): AppData {
  return {
    workers: [],
    clients: [{ id: "c1", name: "顧問先A", code: "C1", active: true, closingMonth: 3, createdAt: NOW }],
    reports: [],
    workTypes: [],
    unitPrices: [],
    sortingUnitPrices: [],
    workerOutsourcePrices: [],
    workerWorkTypeOutsourcePrices: [],
    workerShareLinks: [],
    paymentStatementSettings: {
      title: "", issuerName: "", issuerAddress: "", issuerPhone: "", issuerEmail: "", registrationNumber: "",
      paymentDueText: "", bankFeeText: "", notes: "", footerText: "", updatedAt: NOW
    },
    monthlyWorkReports: [],
    monthlyClosings: [],
    backupRecords: [],
    auditLogs: [],
    ...overrides
  };
}

describe("単位換算（既存仕様の固定）", () => {
  it("件数=1、時間=10分単位", () => {
    expect(unitQuantityFor({ unit: "count" })).toBe(1);
    expect(unitQuantityFor({ unit: "time" })).toBe(10);
    expect(unitPriceLabelFor({ unit: "count" })).toBe("1件あたり");
    expect(unitPriceLabelFor({ unit: "time" })).toBe("10分あたり");
  });

  it("monthFromDate は YYYY-MM を返す", () => {
    expect(monthFromDate("2026-10-31")).toBe("2026-10");
  });
});

describe("月次作業の売上計算", () => {
  const data = appData({
    workTypes: [workType("count-type", "count"), workType("time-type", "time")],
    unitPrices: [unitPrice("count-type", 500, 0), unitPrice("time-type", 500, 300)]
  });

  it("件数単位: 数量×単価（60件×500円=30,000円）", () => {
    expect(calculateMonthlyWorkAmount({ workTypeId: "count-type", documentCount: 60, workMinutes: 0 }, data)).toBe(30000);
  });

  it("時間単位: 分÷10×単価（Math.round）", () => {
    const calc = (minutes: number) => calculateMonthlyWorkAmount({ workTypeId: "time-type", documentCount: 0, workMinutes: minutes }, data);
    expect(calc(10)).toBe(500);
    expect(calc(5)).toBe(250);
    expect(calc(1)).toBe(50);
    expect(calc(3)).toBe(150);
    expect(calc(0)).toBe(0);
  });

  it("端数は四捨五入（0.5は切り上げ）", () => {
    const d = appData({ workTypes: [workType("time-type", "time")], unitPrices: [unitPrice("time-type", 5, 0)] });
    expect(calculateMonthlyWorkAmount({ workTypeId: "time-type", documentCount: 0, workMinutes: 1 }, d)).toBe(1);
    expect(calculateMonthlyWorkAmount({ workTypeId: "time-type", documentCount: 0, workMinutes: 3 }, d)).toBe(2);
  });

  it("unit_prices.quantity が不正でも換算は作業種別の unit から導出される", () => {
    const stale = appData({
      workTypes: [workType("count-type", "count")],
      unitPrices: [unitPrice("count-type", 500, 0, 10)]
    });
    expect(calculateMonthlyWorkAmount({ workTypeId: "count-type", documentCount: 60, workMinutes: 0 }, stale)).toBe(30000);
  });

  it("単価または作業種別が未登録なら0円", () => {
    expect(calculateMonthlyWorkAmount({ workTypeId: "unknown", documentCount: 10, workMinutes: 0 }, data)).toBe(0);
  });
});

describe("外注単価の優先順位", () => {
  const base = appData({
    workTypes: [workType("count-type", "count")],
    unitPrices: [unitPrice("count-type", 500, 100)]
  });

  it("担当者別の有効な個別単価があれば優先", () => {
    const data = appData({
      ...base,
      workerWorkTypeOutsourcePrices: [{ id: "o1", workerId: "w1", workTypeId: "count-type", outsourceUnitPrice: 350, active: true, createdAt: NOW, updatedAt: NOW }]
    });
    expect(resolveMonthlyOutsourceUnitPrice(data, "w1", "count-type", 100)).toEqual({ unitPrice: 350, source: "worker" });
  });

  it("個別単価が0円でも「未設定」ではなく0円として優先される", () => {
    const data = appData({
      ...base,
      workerWorkTypeOutsourcePrices: [{ id: "o1", workerId: "w1", workTypeId: "count-type", outsourceUnitPrice: 0, active: true, createdAt: NOW, updatedAt: NOW }]
    });
    expect(resolveMonthlyOutsourceUnitPrice(data, "w1", "count-type", 100)).toEqual({ unitPrice: 0, source: "worker" });
  });

  it("無効な個別単価・別担当者・別作業種別は作業種別デフォルトにフォールバック", () => {
    const data = appData({
      ...base,
      workerWorkTypeOutsourcePrices: [
        { id: "o1", workerId: "w1", workTypeId: "count-type", outsourceUnitPrice: 350, active: false, createdAt: NOW, updatedAt: NOW },
        { id: "o2", workerId: "w2", workTypeId: "count-type", outsourceUnitPrice: 999, active: true, createdAt: NOW, updatedAt: NOW }
      ]
    });
    expect(resolveMonthlyOutsourceUnitPrice(data, "w1", "count-type", 100)).toEqual({ unitPrice: 100, source: "default" });
    expect(resolveMonthlyOutsourceUnitPrice(data, "w1", "other-type", 100)).toEqual({ unitPrice: 100, source: "default" });
  });
});

describe("月次作業の集計（売上・外注費・粗利）", () => {
  it("外注費は明細単位で担当者別単価を解決して積み上げる", () => {
    const data = appData({
      workTypes: [workType("count-type", "count")],
      unitPrices: [unitPrice("count-type", 500, 100)],
      workerWorkTypeOutsourcePrices: [{ id: "o1", workerId: "w1", workTypeId: "count-type", outsourceUnitPrice: 350, active: true, createdAt: NOW, updatedAt: NOW }],
      monthlyWorkReports: [
        monthlyReport({ id: "m1", workerId: "w1", documentCount: 10 }),
        monthlyReport({ id: "m2", workerId: "w2", documentCount: 10 })
      ]
    });
    const summary = buildMonthlyWorkSummary(data, "2026-10");
    expect(summary.rows).toHaveLength(1);
    const row = summary.rows[0];
    expect(row.documentCount).toBe(20);
    expect(row.revenue).toBe(10000);
    expect(row.outsourceCost).toBe(10 * 350 + 10 * 100);
    expect(row.grossProfit).toBe(10000 - 4500);
    expect(summary.totals.outsourceCost).toBe(4500);
  });

  it("作業種別ごと・顧問先ごとに別行として集計され混ざらない", () => {
    const data = appData({
      clients: [
        { id: "c1", name: "A", code: "C1", active: true, closingMonth: 3, createdAt: NOW },
        { id: "c2", name: "B", code: "C2", active: true, closingMonth: 3, createdAt: NOW }
      ],
      workTypes: [workType("count-type", "count"), workType("time-type", "time")],
      unitPrices: [unitPrice("count-type", 500, 0), unitPrice("time-type", 500, 0)],
      monthlyWorkReports: [
        monthlyReport({ id: "m1", clientId: "c1", workTypeId: "count-type", documentCount: 4 }),
        monthlyReport({ id: "m2", clientId: "c1", workTypeId: "time-type", workMinutes: 20 }),
        monthlyReport({ id: "m3", clientId: "c2", workTypeId: "count-type", documentCount: 6 })
      ]
    });
    const summary = buildMonthlyWorkSummary(data, "2026-10");
    expect(summary.rows).toHaveLength(3);
    expect(summary.totals.revenue).toBe(4 * 500 + 2 * 500 + 6 * 500);
  });

  it("対象月以外の日報は集計されない", () => {
    const data = appData({
      workTypes: [workType("count-type", "count")],
      unitPrices: [unitPrice("count-type", 500, 0)],
      monthlyWorkReports: [monthlyReport({ documentCount: 5, workMonth: "2026-09", workDate: "2026-09-30" })]
    });
    expect(buildMonthlyWorkSummary(data, "2026-10").rows).toHaveLength(0);
  });
});

describe("仕訳の無料枠30件", () => {
  it("無料枠は30件", () => {
    expect(FREE_MANUAL_ALLOWANCE).toBe(30);
  });

  it("手入力を先に無料枠へ充当し、残りをスマート取込へ充当", () => {
    expect(calculateSortingBillableCounts(10, 100)).toEqual({ manualFreeUsed: 10, manualBillable: 0, smartFreeUsed: 20, smartBillable: 80 });
    expect(calculateSortingBillableCounts(50, 100)).toEqual({ manualFreeUsed: 30, manualBillable: 20, smartFreeUsed: 0, smartBillable: 100 });
    expect(calculateSortingBillableCounts(30, 0)).toEqual({ manualFreeUsed: 30, manualBillable: 0, smartFreeUsed: 0, smartBillable: 0 });
    expect(calculateSortingBillableCounts(0, 0)).toEqual({ manualFreeUsed: 0, manualBillable: 0, smartFreeUsed: 0, smartBillable: 0 });
  });
});

describe("対象年度と前回総仕訳数", () => {
  it("決算月3月: 3月まで前年度、4月から当年度", () => {
    expect(fiscalYearFromDate("2026-03-31", 3)).toBe(2025);
    expect(fiscalYearFromDate("2026-04-01", 3)).toBe(2026);
  });

  it("決算月7月: 期首は8月", () => {
    expect(fiscalYearFromDate("2026-07-31", 7)).toBe(2025);
    expect(fiscalYearFromDate("2026-08-01", 7)).toBe(2026);
    expect(fiscalStartMonth(7)).toBe(8);
  });

  it("決算月が不正ならデフォルト3月", () => {
    expect(normalizeClosingMonth(0)).toBe(3);
    expect(normalizeClosingMonth(13)).toBe(3);
    expect(normalizeClosingMonth(undefined)).toBe(3);
    expect(normalizeClosingMonth(12)).toBe(12);
  });

  it("前回日報は同一顧問先・同一対象年度の直前のみ（他年度は参照しない）", () => {
    const reports = [
      dailyReport({ id: "a", workDate: "2026-09-04", fiscalYear: 2026, totalSortingCount: 3804 }),
      dailyReport({ id: "b", workDate: "2026-09-04", fiscalYear: 2027, totalSortingCount: 140 }),
      dailyReport({ id: "c", workDate: "2026-09-12", fiscalYear: 2026, clientId: "c2", totalSortingCount: 999 })
    ];
    const target = { id: "new", clientId: "c1", workDate: "2026-09-20", createdAt: NOW, fiscalYear: 2026 };
    expect(findPreviousReport(reports, target)?.id).toBe("a");
    expect(findPreviousReport(reports, { ...target, fiscalYear: 2027 })?.id).toBe("b");
    expect(findPreviousReport(reports, { ...target, fiscalYear: 2025 })).toBeUndefined();
  });

  it("作業件数は総仕訳数の差分。初回は手入力+スマート取込。マイナスは0", () => {
    const prev = dailyReport({ id: "p", workDate: "2026-09-01", totalSortingCount: 100 });
    const current = dailyReport({ id: "n", workDate: "2026-09-10", totalSortingCount: 130, manualCount: 10, smartImportCount: 20 });
    expect(calculateAutoWorkCount([prev], current)).toBe(30);
    expect(calculateAutoWorkCount([], current)).toBe(30);
    expect(calculateAutoWorkCount([prev], { ...current, totalSortingCount: 90 })).toBe(0);
  });
});

describe("仕訳件数入力の自動計算", () => {
  const filled = (total: string, manual: string, smart: string) => {
    const state = emptySortingCountState();
    return {
      ...state,
      inputs: { totalSortingCount: total, manualCount: manual, smartImportCount: smart },
      manual: { totalSortingCount: total !== "", manualCount: manual !== "", smartImportCount: smart !== "" }
    };
  };

  it("2項目入力で残り1項目を前回総仕訳数込みで自動計算", () => {
    expect(calculateSortingCountState(filled("3826", "22", ""), 3804).inputs.smartImportCount).toBe("0");
    expect(calculateSortingCountState(filled("", "10", "20"), 100).inputs.totalSortingCount).toBe("130");
    expect(calculateSortingCountState(filled("130", "", "20"), 100).inputs.manualCount).toBe("10");
  });

  it("計算結果がマイナスなら警告し自動入力しない", () => {
    const result = calculateSortingCountState(filled("50", "", "20"), 100);
    expect(result.inputs.manualCount).toBe("");
    expect(result.warning).not.toBe("");
  });

  it("3項目入力で整合しなければ警告、整合すれば警告なし", () => {
    expect(calculateSortingCountState(filled("130", "10", "10"), 100).warning).not.toBe("");
    expect(calculateSortingCountState(filled("130", "10", "20"), 100).warning).toBe("");
    expect(calculateSortingCountState(filled("90", "0", "0"), 100).warning).not.toBe("");
  });

  it("入力正規化: 負数は0、小数は切り捨て、非数は空", () => {
    expect(normalizeCountInput("-5")).toBe("0");
    expect(normalizeCountInput("3.9")).toBe("3");
    expect(normalizeCountInput("abc")).toBe("");
    expect(normalizeCountInput("")).toBe("");
  });
});
