import type { AppData, PaymentStatementSettings, SortingUnitPrice, UnitPrice, Worker, WorkerOutsourcePrice, WorkType } from "./types";

const today = new Date().toISOString();

export const defaultWorkTypes: WorkType[] = [
  { id: "submitted-documents", code: "T001", name: "提出書類", unit: "count", active: true, createdAt: today },
  { id: "office-work", code: "T002", name: "その他事務業務", unit: "time", active: true, createdAt: today }
];

export const defaultUnitPrices: UnitPrice[] = [
  { workTypeId: "submitted-documents", amount: 3000, costAmount: 0, outsourceAmount: 1000, quantity: 1, unitLabel: "1件あたり", createdAt: today, updatedAt: today },
  { workTypeId: "office-work", amount: 500, costAmount: 0, outsourceAmount: 300, quantity: 10, unitLabel: "10分あたり", createdAt: today, updatedAt: today }
];

export const defaultSortingUnitPrices: SortingUnitPrice[] = [
  { id: "manual", name: "手入力", amount: 60, costAmount: 40, quantity: 1, unitLabel: "1件あたり", createdAt: today, updatedAt: today },
  { id: "smart", name: "スマート取込", amount: 40, costAmount: 0, quantity: 1, unitLabel: "1件あたり", createdAt: today, updatedAt: today }
];

export function defaultWorkerOutsourcePrices(workers: Worker[]): WorkerOutsourcePrice[] {
  return workers.map((worker) => ({
    workerId: worker.id,
    manualUnitPrice: 40,
    smartUnitPrice: 20,
    submittedDocumentsUnitPrice: 1000,
    officeWorkUnitPrice: 300,
    createdAt: today,
    updatedAt: today
  }));
}

export const defaultPaymentStatementSettings: PaymentStatementSettings = {
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
  updatedAt: today
};

export const sampleData: AppData = {
  workers: [
    { id: "worker-a", code: "W001", name: "佐藤 花子", active: true, createdAt: today },
    { id: "worker-b", code: "W002", name: "鈴木 一郎", active: true, createdAt: today },
    { id: "worker-c", code: "W003", name: "田中 美咲", active: true, createdAt: today }
  ],
  clients: [
    { id: "client-a", name: "青山商事", code: "A001", active: true, createdAt: today },
    { id: "client-b", name: "北浜物流", code: "B002", active: true, createdAt: today },
    { id: "client-c", name: "中央フーズ", code: "C003", active: true, createdAt: today }
  ],
  reports: [
    {
      id: "report-1",
      workDate: "2026-07-01",
      workMonth: "2026-07",
      workerId: "worker-a",
      clientId: "client-a",
      manualCount: 22,
      smartImportCount: 140,
      totalSortingCount: 320,
      memo: "月初処理",
      source: "admin",
      sourceWorkerId: "",
      createdAt: today,
      updatedAt: today
    },
    {
      id: "report-2",
      workDate: "2026-07-02",
      workMonth: "2026-07",
      workerId: "worker-b",
      clientId: "client-a",
      manualCount: 18,
      smartImportCount: 95,
      totalSortingCount: 466,
      memo: "",
      source: "admin",
      sourceWorkerId: "",
      createdAt: today,
      updatedAt: today
    },
    {
      id: "report-3",
      workDate: "2026-07-03",
      workMonth: "2026-07",
      workerId: "worker-c",
      clientId: "client-b",
      manualCount: 45,
      smartImportCount: 210,
      totalSortingCount: 810,
      memo: "取込確認済み",
      source: "admin",
      sourceWorkerId: "",
      createdAt: today,
      updatedAt: today
    }
  ],
  workTypes: defaultWorkTypes,
  unitPrices: defaultUnitPrices,
  sortingUnitPrices: defaultSortingUnitPrices,
  workerOutsourcePrices: defaultWorkerOutsourcePrices([
    { id: "worker-a", code: "W001", name: "佐藤 花子", active: true, createdAt: today },
    { id: "worker-b", code: "W002", name: "鈴木 一郎", active: true, createdAt: today },
    { id: "worker-c", code: "W003", name: "田中 美咲", active: true, createdAt: today }
  ]),
  workerShareLinks: [],
  paymentStatementSettings: defaultPaymentStatementSettings,
  monthlyWorkReports: [
    {
      id: "monthly-work-1",
      workDate: "2026-07-04",
      workMonth: "2026-07",
      workerId: "worker-a",
      workTypeId: "submitted-documents",
      clientId: "client-a",
      documentCount: 3,
      workMinutes: 0,
      memo: "契約関連書類",
      source: "admin",
      sourceWorkerId: "",
      createdAt: today,
      updatedAt: today
    },
    {
      id: "monthly-work-2",
      workDate: "2026-07-05",
      workMonth: "2026-07",
      workerId: "worker-b",
      workTypeId: "office-work",
      clientId: "client-b",
      documentCount: 0,
      workMinutes: 40,
      memo: "資料整理",
      source: "admin",
      sourceWorkerId: "",
      createdAt: today,
      updatedAt: today
    }
  ]
};
