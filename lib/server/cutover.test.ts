import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_COMMANDS, runAdminCommand } from "./admin-commands";
import { forClient } from "./admin-data";
import { generateShareToken, hashShareToken } from "./share-link-token";
import { reportIdFor } from "./work-report-rules";
import type { AppData } from "../types";

const NOW = "2026-11-01T00:00:00.000Z";

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    workers: [{ id: "w1", code: "W001", name: "担当A", active: true, createdAt: NOW }],
    clients: [], reports: [], workTypes: [], unitPrices: [], sortingUnitPrices: [], workerOutsourcePrices: [], workerWorkTypeOutsourcePrices: [],
    workerShareLinks: [],
    paymentStatementSettings: { title: "", issuerName: "", issuerAddress: "", issuerPhone: "", issuerEmail: "", registrationNumber: "", paymentDueText: "", bankFeeText: "", notes: "", footerText: "", updatedAt: NOW },
    monthlyWorkReports: [], monthlyClosings: [], backupRecords: [], auditLogs: [],
    ...overrides
  };
}

describe("共有リンクのトークン", () => {
  it("十分な長さのランダム値で、外注者APIの形式チェックを通る", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateShareToken()).not.toBe(token);
  });

  it("DBにはSHA-256のハッシュだけを保存する（同じ値なら同じハッシュ、平文は含まない）", () => {
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("画面へ返すデータからトークンを除く", () => {
    const result = forClient(data({ workerShareLinks: [{ workerId: "w1", token: "secret-plaintext", active: true, createdAt: NOW, updatedAt: NOW }] }));
    expect(result.workerShareLinks[0].token).toBe("");
  });

  it("平文トークンを作る旧発行コマンドは管理APIに無い", () => {
    expect(ADMIN_COMMANDS).not.toContain("workerShareLink.issue");
  });

  it("未発行の担当者のリンク有効化は、平文リンクを作らずエラー", async () => {
    await expect(runAdminCommand("workerShareLink.toggle", { workerId: "w1", active: true }, data(), { adminEmail: "a@example.com" })).rejects.toThrow("未発行");
  });
});

describe("送信IDによる二重登録防止", () => {
  it("同じ送信IDなら同じ日報IDになる", () => {
    const requestId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(reportIdFor("report", requestId, () => "x")).toBe(`report-${requestId}`);
    expect(reportIdFor("report", requestId.toUpperCase(), () => "x")).toBe(`report-${requestId}`);
  });

  it("形式が不正な送信IDは使わず、新しいIDを振る", () => {
    expect(reportIdFor("report", "../../etc", () => "fresh")).toBe("report-fresh");
    expect(reportIdFor("report", undefined, () => "fresh")).toBe("report-fresh");
  });
});

describe("切替SQLとschema.sql", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const sqlFiles = ["01_additive.sql", "02_lockdown.sql", "03_revoke_old_links.sql", "verify.sql"].map((name) => readFileSync(`supabase/cutover/${name}`, "utf8"));

  it("schema.sql は全許可ポリシーを作らず、再実行で公開状態に戻らない", () => {
    expect(schema).not.toMatch(/create policy/i);
    expect(schema).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(schema).toMatch(/revoke all on all tables in schema public from anon, authenticated;/);
  });

  it("schema.sql の先頭に不可視文字（BOM）がない", () => {
    expect(schema.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("破壊的なSQL（DROP TABLE・TRUNCATE・無条件DELETE）を含まない", () => {
    for (const sql of [schema, ...sqlFiles]) {
      expect(sql).not.toMatch(/drop\s+table/i);
      expect(sql).not.toMatch(/^\s*truncate/im);
      expect(sql).not.toMatch(/delete\s+from/i);
    }
  });

  it("確定月の保護トリガーは日報2表と月次確定に設定される", () => {
    expect(schema).toMatch(/create trigger daily_reports_enforce_open_month/);
    expect(schema).toMatch(/create trigger monthly_work_reports_enforce_open_month/);
    expect(schema).toMatch(/create trigger monthly_closings_lock_month/);
  });

  it("anonへの権限付与（grant ... to anon）を含まない", () => {
    for (const sql of [schema, ...sqlFiles]) expect(sql).not.toMatch(/grant[^;]*to\s+(anon|authenticated|public)/i);
  });
});
