export type Worker = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
};

export type ReportSource = "admin" | "worker_link";

export type WorkerShareLink = {
  workerId: string;
  token: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Client = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  closingMonth: number;
  createdAt: string;
};

export type DailyReport = {
  id: string;
  workDate: string;
  workMonth: string;
  workerId: string;
  clientId: string;
  manualCount: number;
  smartImportCount: number;
  totalSortingCount: number;
  memo: string;
  source: ReportSource;
  sourceWorkerId: string;
  fiscalYear: number;
  fiscalYearLabel: string;
  clientClosingMonth: number;
  clientFiscalStartMonth: number;
  previousTotalJournalCount: number;
  currentTotalJournalCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkUnit = "count" | "time";

export type WorkType = {
  id: string;
  code: string;
  name: string;
  unit: WorkUnit;
  active: boolean;
  createdAt: string;
};

export type UnitPrice = {
  workTypeId: string;
  amount: number;
  costAmount: number;
  outsourceAmount: number;
  quantity: number;
  unitLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type SortingPriceId = "manual" | "smart";

export type SortingUnitPrice = {
  id: SortingPriceId;
  name: string;
  amount: number;
  costAmount: number;
  quantity: number;
  unitLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkerOutsourcePrice = {
  workerId: string;
  manualUnitPrice: number;
  smartUnitPrice: number;
  submittedDocumentsUnitPrice: number;
  officeWorkUnitPrice: number;
  createdAt: string;
  updatedAt: string;
};

export type PaymentStatementSettings = {
  title: string;
  issuerName: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerEmail: string;
  registrationNumber: string;
  paymentDueText: string;
  bankFeeText: string;
  notes: string;
  footerText: string;
  updatedAt: string;
};

export type MonthlyWorkReport = {
  id: string;
  workDate: string;
  workMonth: string;
  workerId: string;
  workTypeId: string;
  clientId: string;
  documentCount: number;
  workMinutes: number;
  memo: string;
  source: ReportSource;
  sourceWorkerId: string;
  createdAt: string;
  updatedAt: string;
};

export type AppData = {
  workers: Worker[];
  clients: Client[];
  reports: DailyReport[];
  workTypes: WorkType[];
  unitPrices: UnitPrice[];
  sortingUnitPrices: SortingUnitPrice[];
  workerOutsourcePrices: WorkerOutsourcePrice[];
  workerShareLinks: WorkerShareLink[];
  paymentStatementSettings: PaymentStatementSettings;
  monthlyWorkReports: MonthlyWorkReport[];
  monthlyClosings: MonthlyClosing[];
  backupRecords: BackupRecord[];
  auditLogs: AuditLog[];
};

export type MonthlyClosing = {
  id: string;
  targetMonth: string;
  isClosed: boolean;
  closedAt: string;
  closedBy: string;
  closingBackupId: string;
  salesTotal: number;
  outsourceTotal: number;
  grossProfit: number;
  reportCount: number;
  note: string;
  reopenedAt: string;
  reopenedBy: string;
  reopenReason: string;
  createdAt: string;
  updatedAt: string;
};

export type BackupRecord = {
  id: string;
  backupDatetime: string;
  backupType: "full_json" | "work_logs" | "settings";
  targetMonth: string;
  createdBy: string;
  fileName: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  targetMonth: string;
  message: string;
  beforeData?: unknown;
  afterData?: unknown;
  createdBy: string;
  createdAt: string;
};

export type ReportInput = Omit<
  DailyReport,
  "id" | "workMonth" | "source" | "sourceWorkerId" | "fiscalYearLabel" | "clientClosingMonth" | "clientFiscalStartMonth" | "previousTotalJournalCount" | "currentTotalJournalCount" | "createdAt" | "updatedAt"
> &
  Partial<Pick<DailyReport, "source" | "sourceWorkerId">>;

export type MonthlyWorkReportInput = Omit<MonthlyWorkReport, "id" | "workMonth" | "source" | "sourceWorkerId" | "createdAt" | "updatedAt"> & Partial<Pick<MonthlyWorkReport, "source" | "sourceWorkerId">>;

export type SummaryRow = {
  key: string;
  workerId: string;
  workerName: string;
  clientId: string;
  clientName: string;
  manualCount: number;
  manualFreeAppliedCount: number;
  manualBillableCount: number;
  smartImportCount: number;
  smartBillableCount: number;
  smartFreeAppliedCount: number;
  invoiceTargetCount: number;
  autoWorkCount: number;
  fiscalYearLabels: string;
};

export type ClientSummaryRow = {
  clientId: string;
  clientName: string;
  manualCount: number;
  manualFreeCount: number;
  manualFreeAppliedCount: number;
  manualBillableCount: number;
  manualRevenueUnitPrice: number;
  manualRevenue: number;
  manualCostUnitPrice: number;
  manualCost: number;
  smartImportCount: number;
  smartBillableCount: number;
  smartFreeAppliedCount: number;
  smartRevenueUnitPrice: number;
  smartRevenue: number;
  smartCostUnitPrice: number;
  smartCost: number;
  invoiceTargetCount: number;
  sortingRevenue: number;
  sortingCost: number;
  sortingGrossProfit: number;
  manualOutsourceCost: number;
  smartOutsourceCost: number;
  sortingOutsourceCost: number;
  fiscalYearLabels: string;
};

export type MonthlyWorkSummaryRow = {
  key: string;
  clientId: string;
  clientName: string;
  workTypeId: WorkType["id"];
  workTypeName: string;
  unit: WorkUnit;
  documentCount: number;
  workMinutes: number;
  revenueUnitPrice: number;
  costUnitPrice: number;
  outsourceUnitPrice: number;
  unitQuantity: number;
  unitLabel: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  outsourceCost: number;
};

export type ClientBillingRow = {
  clientId: string;
  clientName: string;
  rows: MonthlyWorkSummaryRow[];
  totalRevenue: number;
  totalCost: number;
  totalOutsourceCost: number;
  grossProfit: number;
};

export type OutsourceDetailRow = {
  id: string;
  workerId: string;
  workerName: string;
  workDate: string;
  clientName: string;
  workKind: string;
  quantity: number;
  quantityLabel: string;
  unitPrice: number;
  amount: number;
  memo: string;
};

export type WorkerOutsourceSummaryRow = {
  workerId: string;
  workerName: string;
  manualCount: number;
  manualAmount: number;
  smartImportCount: number;
  smartImportAmount: number;
  submittedDocumentsCount: number;
  submittedDocumentsAmount: number;
  officeWorkMinutes: number;
  officeWorkAmount: number;
  totalAmount: number;
  details: OutsourceDetailRow[];
};

export type ClientProfitabilityRow = {
  clientId: string;
  clientName: string;
  sortingRevenue: number;
  submittedDocumentsRevenue: number;
  officeWorkRevenue: number;
  totalRevenue: number;
  manualOutsourceCost: number;
  smartOutsourceCost: number;
  submittedDocumentsOutsourceCost: number;
  officeWorkOutsourceCost: number;
  totalOutsourceCost: number;
  grossProfit: number;
  grossProfitRate: number;
  sortingDetail?: ClientSummaryRow;
};
