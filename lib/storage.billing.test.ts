import { afterEach, describe, expect, it } from "vitest";
import { setBillingSchemaReadyForTest, upsertClientWorkTypeBillingPrice, upsertMonthlyWorkReport, deleteClientWorkTypeBillingPrice } from "./storage";
import type { AppData } from "./types";

const NOW = "2026-11-01T00:00:00.000Z";

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    workers: [{ id: "w1", code: "W001", name: "担当A", active: true, createdAt: NOW }],
    clients: [{ id: "c1", name: "顧問先A", code: "C001", active: true, closingMonth: 3, createdAt: NOW }],
    reports: [],
    workTypes: [{ id: "board", code: "T010", name: "役員会議支援", unit: "count", active: true, createdAt: NOW }],
    unitPrices: [{ workTypeId: "board", amount: 30000, costAmount: 0, outsourceAmount: 0, quantity: 1, unitLabel: "", createdAt: NOW, updatedAt: NOW }],
    sortingUnitPrices: [],
    workerOutsourcePrices: [],
    workerWorkTypeOutsourcePrices: [],
    clientWorkTypeBillingPrices: [],
    workerShareLinks: [],
    paymentStatementSettings: { title: "", issuerName: "", issuerAddress: "", issuerPhone: "", issuerEmail: "", registrationNumber: "", paymentDueText: "", bankFeeText: "", notes: "", footerText: "", updatedAt: NOW },
    monthlyWorkReports: [],
    monthlyClosings: [],
    backupRecords: [],
    auditLogs: [],
    ...overrides
  };
}

const input = { workDate: "2026-11-10", workerId: "w1", workTypeId: "board", clientId: "c1", documentCount: 1, workMinutes: 0, memo: "" };

afterEach(() => setBillingSchemaReadyForTest(false));

describe("月次作業の保存（ローカル動作）", () => {
  it("DB更新が未適用なら単価を記録しない（従来どおり）", async () => {
    setBillingSchemaReadyForTest(false);
    const next = await upsertMonthlyWorkReport(input, data());
    expect(next.monthlyWorkReports[0].billedUnitPrice ?? null).toBeNull();
  });

  it("顧問先別単価を登録すると、以後の保存で自動適用・記録される", async () => {
    setBillingSchemaReadyForTest(true);
    const withPrice = await upsertClientWorkTypeBillingPrice({ clientId: "c1", workTypeId: "board", unitPrice: 25000 }, data());
    const next = await upsertMonthlyWorkReport(input, withPrice);
    expect(next.monthlyWorkReports[0]).toMatchObject({ billedUnitPrice: 25000, billedUnitQuantity: 1, billedPriceSource: "client" });
  });

  it("今回限りの単価は操作履歴に残る", async () => {
    setBillingSchemaReadyForTest(true);
    const next = await upsertMonthlyWorkReport({ ...input, billingOverrideUnitPrice: 20000, billingOverrideReason: "初回" }, data());
    expect(next.monthlyWorkReports[0]).toMatchObject({ billedUnitPrice: 20000, billedPriceSource: "override", billingOverrideReason: "初回" });
    expect(next.auditLogs.some((log) => log.actionType === "billing_override")).toBe(true);
  });

  it("確定済みの月には保存できない", async () => {
    setBillingSchemaReadyForTest(true);
    const closed = data({
      monthlyClosings: [{ id: "x", targetMonth: "2026-11", isClosed: true, closedAt: NOW, closedBy: "admin", closingBackupId: "", salesTotal: 0, outsourceTotal: 0, grossProfit: 0, reportCount: 0, note: "", reopenedAt: "", reopenedBy: "", reopenReason: "", createdAt: NOW, updatedAt: NOW }]
    });
    await expect(upsertMonthlyWorkReport(input, closed)).rejects.toThrow();
  });

  it("顧問先別単価を解除しても、保存済みの日報の単価は変わらない", async () => {
    setBillingSchemaReadyForTest(true);
    const withPrice = await upsertClientWorkTypeBillingPrice({ clientId: "c1", workTypeId: "board", unitPrice: 25000 }, data());
    const saved = await upsertMonthlyWorkReport(input, withPrice);
    const removed = await deleteClientWorkTypeBillingPrice(saved.clientWorkTypeBillingPrices[0].id, saved);
    expect(removed.monthlyWorkReports[0].billedUnitPrice).toBe(25000);
  });

  it("0円の顧問先別単価も登録できる（負の単価は不可）", async () => {
    setBillingSchemaReadyForTest(true);
    const zero = await upsertClientWorkTypeBillingPrice({ clientId: "c1", workTypeId: "board", unitPrice: 0 }, data());
    expect(zero.clientWorkTypeBillingPrices[0].unitPrice).toBe(0);
    await expect(upsertClientWorkTypeBillingPrice({ clientId: "c1", workTypeId: "board", unitPrice: -1 }, data())).rejects.toThrow();
  });
});
