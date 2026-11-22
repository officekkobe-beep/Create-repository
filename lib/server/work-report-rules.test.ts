import { describe, expect, it } from "vitest";
import {
  buildMonthlyRecord,
  buildSortingRecord,
  isAllowedFiscalYear,
  isDuplicateMonthly,
  isDuplicateSorting,
  isValidWorkDate,
  parseMonthlyInput,
  parseSortingInput,
  previousTotalFor,
  SORTING_MISMATCH_MESSAGE,
  SORTING_REGRESSION_MESSAGE,
  validateMonthlyQuantity,
  validateSortingCounts,
  type MonthlyInput,
  type SortingInput
} from "./work-report-rules";
import type { DailyReport, MonthlyWorkReport } from "../types";

const NOW = "2026-11-23T00:00:00.000Z";

const sorting: SortingInput = { workDate: "2026-11-20", clientId: "c1", fiscalYear: 2026, totalSortingCount: 130, manualCount: 10, smartImportCount: 20, memo: "" };
const monthly: MonthlyInput = { workDate: "2026-11-20", clientId: "c1", workTypeId: "t1", documentCount: 5, workMinutes: 0, memo: "" };

function daily(overrides: Partial<DailyReport>): DailyReport {
  return {
    id: "r1", workDate: "2026-11-01", workMonth: "2026-11", workerId: "w1", clientId: "c1", manualCount: 0, smartImportCount: 0,
    totalSortingCount: 100, memo: "", source: "admin", sourceWorkerId: "", fiscalYear: 2026, fiscalYearLabel: "2026年度",
    clientClosingMonth: 3, clientFiscalStartMonth: 4, previousTotalJournalCount: 0, currentTotalJournalCount: 100, createdAt: NOW, updatedAt: NOW,
    ...overrides
  };
}

function monthlyReport(overrides: Partial<MonthlyWorkReport>): MonthlyWorkReport {
  return {
    id: "m1", workDate: "2026-11-20", workMonth: "2026-11", workerId: "w1", workTypeId: "t1", clientId: "c1", documentCount: 5,
    workMinutes: 0, memo: "", source: "worker_link", sourceWorkerId: "w1", createdAt: NOW, updatedAt: NOW, ...overrides
  };
}

describe("入力の解析（不正値の拒否）", () => {
  it("存在しない日付・形式違いを拒否", () => {
    expect(isValidWorkDate("2026-02-30")).toBe(false);
    expect(isValidWorkDate("2026/11/20")).toBe(false);
    expect(isValidWorkDate("2026-11-20")).toBe(true);
  });

  it("仕訳: 負数・小数・文字列の件数を拒否", () => {
    expect(parseSortingInput({ ...sorting, manualCount: -1 }).ok).toBe(false);
    expect(parseSortingInput({ ...sorting, manualCount: 1.5 }).ok).toBe(false);
    expect(parseSortingInput({ ...sorting, manualCount: "10" }).ok).toBe(false);
    expect(parseSortingInput({ ...sorting, clientId: "" }).ok).toBe(false);
    expect(parseSortingInput(null).ok).toBe(false);
  });

  it("仕訳: 担当者IDなど余計な項目は値に含めない", () => {
    const parsed = parseSortingInput({ ...sorting, workerId: "other", memo: "  メモ  " });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).not.toHaveProperty("workerId");
      expect(parsed.value.memo).toBe("メモ");
    }
  });

  it("メモが長すぎる場合は拒否", () => {
    expect(parseSortingInput({ ...sorting, memo: "a".repeat(1001) }).ok).toBe(false);
    expect(parseMonthlyInput({ ...monthly, memo: "a".repeat(1001) }).ok).toBe(false);
  });

  it("月次: 作業種別なし・負数を拒否", () => {
    expect(parseMonthlyInput({ ...monthly, workTypeId: "" }).ok).toBe(false);
    expect(parseMonthlyInput({ ...monthly, workMinutes: -10 }).ok).toBe(false);
    expect(parseMonthlyInput(monthly).ok).toBe(true);
  });
});

describe("仕訳件数の整合", () => {
  it("今回総仕訳数が前回を下回ると拒否", () => {
    expect(validateSortingCounts({ ...sorting, totalSortingCount: 90 }, 100)).toBe(SORTING_REGRESSION_MESSAGE);
  });
  it("作業件数と内訳が一致しないと拒否", () => {
    expect(validateSortingCounts({ ...sorting, manualCount: 11 }, 100)).toBe(SORTING_MISMATCH_MESSAGE);
  });
  it("一致すれば受付", () => {
    expect(validateSortingCounts(sorting, 100)).toBeNull();
  });
  it("前回総仕訳数は同一顧問先・同一年度の直前の日報", () => {
    const reports = [daily({ id: "a", totalSortingCount: 100 }), daily({ id: "b", fiscalYear: 2027, totalSortingCount: 5 }), daily({ id: "c", workDate: "2026-11-25", totalSortingCount: 999 })];
    expect(previousTotalFor(reports, sorting, NOW)).toBe(100);
    expect(previousTotalFor([], sorting, NOW)).toBe(0);
  });
});

describe("対象年度の範囲", () => {
  it("自動判定年度の前後1年のみ許可", () => {
    expect(isAllowedFiscalYear(2026, "2026-11-20", 3)).toBe(true);
    expect(isAllowedFiscalYear(2025, "2026-11-20", 3)).toBe(true);
    expect(isAllowedFiscalYear(2027, "2026-11-20", 3)).toBe(true);
    expect(isAllowedFiscalYear(2024, "2026-11-20", 3)).toBe(false);
  });
});

describe("月次作業の数量", () => {
  it("件数単位は数量、時間単位は作業時間が必要", () => {
    expect(validateMonthlyQuantity({ ...monthly, documentCount: 0 }, "count")).not.toBeNull();
    expect(validateMonthlyQuantity({ ...monthly, workMinutes: 0 }, "time")).not.toBeNull();
    expect(validateMonthlyQuantity(monthly, "count")).toBeNull();
    expect(validateMonthlyQuantity({ ...monthly, workMinutes: 30 }, "time")).toBeNull();
  });
});

describe("重複の検出", () => {
  it("仕訳: 同じ担当者・顧問先・日付・年度・総仕訳数なら重複", () => {
    const existing = [daily({ workDate: "2026-11-20", totalSortingCount: 130 })];
    expect(isDuplicateSorting(existing, "w1", sorting)).toBe(true);
    expect(isDuplicateSorting(existing, "w2", sorting)).toBe(false);
    expect(isDuplicateSorting(existing, "w1", { ...sorting, totalSortingCount: 131 })).toBe(false);
  });

  it("月次: 単位に応じた数量まで一致したら重複", () => {
    expect(isDuplicateMonthly([monthlyReport({})], "w1", monthly, "count")).toBe(true);
    expect(isDuplicateMonthly([monthlyReport({ documentCount: 6 })], "w1", monthly, "count")).toBe(false);
    expect(isDuplicateMonthly([monthlyReport({ workTypeId: "t2" })], "w1", monthly, "count")).toBe(false);
    expect(isDuplicateMonthly([monthlyReport({ workMinutes: 30, documentCount: 0 })], "w1", { ...monthly, documentCount: 0, workMinutes: 30 }, "time")).toBe(true);
  });
});

describe("保存レコードの生成", () => {
  it("仕訳: 作業月・年度ラベル・期首月・前回総仕訳数を設定し、登録元は外注者リンク", () => {
    const record = buildSortingRecord({ id: "x", input: sorting, workerId: "w1", clientClosingMonth: 7, previousTotal: 100, source: "worker_link", sourceWorkerId: "w1", now: NOW });
    expect(record).toMatchObject({
      workMonth: "2026-11", fiscalYearLabel: "2026年度", clientClosingMonth: 7, clientFiscalStartMonth: 8,
      previousTotalJournalCount: 100, currentTotalJournalCount: 130, workerId: "w1", source: "worker_link", createdAt: NOW
    });
  });

  it("月次: 単位と異なる数量は0にする", () => {
    const countRecord = buildMonthlyRecord({ id: "x", input: { ...monthly, workMinutes: 40 }, workerId: "w1", unit: "count", source: "worker_link", sourceWorkerId: "w1", now: NOW });
    expect(countRecord).toMatchObject({ documentCount: 5, workMinutes: 0, workMonth: "2026-11" });
    const timeRecord = buildMonthlyRecord({ id: "x", input: { ...monthly, workMinutes: 40 }, workerId: "w1", unit: "time", source: "worker_link", sourceWorkerId: "w1", now: NOW });
    expect(timeRecord).toMatchObject({ documentCount: 0, workMinutes: 40 });
  });
});
