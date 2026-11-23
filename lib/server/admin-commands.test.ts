import { describe, expect, it } from "vitest";
import { ADMIN_COMMANDS, closingTotals, runAdminCommand } from "./admin-commands";
import { CLOSED_MONTH_MESSAGE } from "../storage";
import type { AppData, MonthlyClosing, MonthlyWorkReport } from "../types";

// DB接続なし（環境変数未設定）で既存の保存処理をメモリ上のデータに対して実行する。
const NOW = "2026-11-01T00:00:00.000Z";
const ctx = { adminEmail: "admin@example.com" };

function closing(targetMonth: string): MonthlyClosing {
  return {
    id: `closing-${targetMonth}`, targetMonth, isClosed: true, closedAt: NOW, closedBy: "admin", closingBackupId: "", salesTotal: 0, outsourceTotal: 0,
    grossProfit: 0, reportCount: 0, note: "", reopenedAt: "", reopenedBy: "", reopenReason: "", createdAt: NOW, updatedAt: NOW
  };
}

function monthlyReport(overrides: Partial<MonthlyWorkReport>): MonthlyWorkReport {
  return {
    id: "m1", workDate: "2026-10-15", workMonth: "2026-10", workerId: "w1", workTypeId: "t1", clientId: "c1", documentCount: 10, workMinutes: 0,
    memo: "", source: "admin", sourceWorkerId: "", createdAt: NOW, updatedAt: NOW, ...overrides
  };
}

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    workers: [{ id: "w1", code: "W001", name: "担当A", active: true, createdAt: NOW }],
    clients: [{ id: "c1", name: "顧問先A", code: "C001", active: true, closingMonth: 3, createdAt: NOW }],
    reports: [],
    workTypes: [{ id: "t1", code: "T001", name: "給与計算", unit: "count", active: true, createdAt: NOW }],
    unitPrices: [{ workTypeId: "t1", amount: 1000, costAmount: 0, outsourceAmount: 400, quantity: 1, unitLabel: "件", createdAt: NOW, updatedAt: NOW }],
    sortingUnitPrices: [],
    workerOutsourcePrices: [],
    workerWorkTypeOutsourcePrices: [],
    clientWorkTypeBillingPrices: [],
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

const monthlyInput = { workDate: "2026-11-10", workerId: "w1", clientId: "c1", workTypeId: "t1", documentCount: 5, workMinutes: 0, memo: "" };

describe("コマンドの受付範囲", () => {
  it("未登録のコマンドは拒否（汎用プロキシにしない）", async () => {
    await expect(runAdminCommand("daily_reports.delete_all", {}, data(), ctx)).rejects.toThrow("この操作は利用できません。");
    await expect(runAdminCommand("constructor", {}, data(), ctx)).rejects.toThrow("この操作は利用できません。");
    await expect(runAdminCommand("toString", {}, data(), ctx)).rejects.toThrow("この操作は利用できません。");
  });

  it("サンプルデータ投入は管理APIに含めない", () => {
    expect(ADMIN_COMMANDS.some((name) => name.toLowerCase().includes("sample"))).toBe(false);
  });
});

describe("月次作業日報の保存", () => {
  it("未確定月は保存でき、単位と異なる数量は0になる", async () => {
    const next = await runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, workMinutes: 30 } }, data(), ctx);
    expect(next.monthlyWorkReports).toHaveLength(1);
    expect(next.monthlyWorkReports[0]).toMatchObject({ workMonth: "2026-11", documentCount: 5, workMinutes: 0 });
  });

  it("確定月への登録は拒否", async () => {
    await expect(runAdminCommand("monthlyReport.upsert", { input: monthlyInput }, data({ monthlyClosings: [closing("2026-11")] }), ctx)).rejects.toThrow(CLOSED_MONTH_MESSAGE);
  });

  it("確定月の日報を、作業日を変えて未確定月へ移す編集も拒否", async () => {
    const current = data({ monthlyClosings: [closing("2026-10")], monthlyWorkReports: [monthlyReport({})] });
    await expect(runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, id: "m1" } }, current, ctx)).rejects.toThrow(CLOSED_MONTH_MESSAGE);
  });

  it("確定月の日報の削除は拒否", async () => {
    const current = data({ monthlyClosings: [closing("2026-10")], monthlyWorkReports: [monthlyReport({})] });
    await expect(runAdminCommand("monthlyReport.delete", { id: "m1" }, current, ctx)).rejects.toThrow(CLOSED_MONTH_MESSAGE);
  });

  it("存在しない担当者・顧問先・作業種別、数量0は拒否", async () => {
    await expect(runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, workerId: "x" } }, data(), ctx)).rejects.toThrow("担当者");
    await expect(runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, clientId: "x" } }, data(), ctx)).rejects.toThrow("顧問先");
    await expect(runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, workTypeId: "x" } }, data(), ctx)).rejects.toThrow("作業種別");
    await expect(runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, documentCount: 0 } }, data(), ctx)).rejects.toThrow("数量");
  });

  it("編集・削除は操作履歴に残る", async () => {
    const current = data({ monthlyWorkReports: [monthlyReport({ workDate: "2026-11-01", workMonth: "2026-11" })] });
    const updated = await runAdminCommand("monthlyReport.upsert", { input: { ...monthlyInput, id: "m1", documentCount: 7 } }, current, ctx);
    expect(updated.auditLogs[0]).toMatchObject({ actionType: "update", targetId: "m1" });
    const deleted = await runAdminCommand("monthlyReport.delete", { id: "m1" }, updated, ctx);
    expect(deleted.auditLogs[0]).toMatchObject({ actionType: "delete", targetId: "m1" });
    expect(deleted.monthlyWorkReports).toHaveLength(0);
  });
});

describe("仕訳日報の保存", () => {
  const input = { workDate: "2026-11-10", workerId: "w1", clientId: "c1", fiscalYear: 2026, totalSortingCount: 30, manualCount: 10, smartImportCount: 20, memo: "" };

  it("件数が整合すれば保存", async () => {
    const next = await runAdminCommand("report.upsert", { input }, data(), ctx);
    expect(next.reports[0]).toMatchObject({ totalSortingCount: 30, previousTotalJournalCount: 0, fiscalYearLabel: "2026年度" });
  });

  it("文字列の件数や不整合は拒否", async () => {
    await expect(runAdminCommand("report.upsert", { input: { ...input, manualCount: "10" } }, data(), ctx)).rejects.toThrow();
    await expect(runAdminCommand("report.upsert", { input: { ...input, manualCount: 11 } }, data(), ctx)).rejects.toThrow("一致していません");
  });
});

describe("月次確定", () => {
  it("バックアップがなければ確定できない（既存ルール）", async () => {
    await expect(runAdminCommand("month.close", { targetMonth: "2026-11" }, data(), ctx)).rejects.toThrow("バックアップ");
  });

  it("確定時の集計値はサーバーで計算し、画面から送られた値は使わない", async () => {
    const current = data({ monthlyWorkReports: [monthlyReport({ workDate: "2026-11-05", workMonth: "2026-11", documentCount: 3 })] });
    const backedUp = await runAdminCommand("backup.recordFull", { targetMonth: "2026-11", fileName: "backup.json" }, current, ctx);
    const closed = await runAdminCommand("month.close", { targetMonth: "2026-11", salesTotal: 999999, note: "確定" }, backedUp, ctx);
    const record = closed.monthlyClosings.find((item) => item.targetMonth === "2026-11");
    expect(record).toMatchObject({ isClosed: true, salesTotal: 3000, outsourceTotal: 1200, grossProfit: 1800, reportCount: 1, closedBy: "admin@example.com" });
    expect(closingTotals(current, "2026-11").salesTotal).toBe(3000);
  });

  it("解除理由がなければ解除できない", async () => {
    await expect(runAdminCommand("month.reopen", { targetMonth: "2026-10", reason: " " }, data({ monthlyClosings: [closing("2026-10")] }), ctx)).rejects.toThrow("解除理由");
  });
});
