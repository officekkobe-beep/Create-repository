import type {
  AppData,
  ClientBillingRow,
  ClientProfitabilityRow,
  ClientSummaryRow,
  DailyReport,
  MonthlyWorkReport,
  MonthlyWorkSummaryRow,
  OutsourceDetailRow,
  SummaryRow,
  UnitPrice,
  WorkerOutsourcePrice,
  WorkerOutsourceSummaryRow,
  WorkType
} from "./types";

export const FREE_MANUAL_ALLOWANCE = 30;

export function monthFromDate(date: string) {
  return date.slice(0, 7);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

export function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function findPreviousReport(reports: DailyReport[], report: Pick<DailyReport, "id" | "clientId" | "workDate" | "createdAt" | "fiscalYear">) {
  return reports
    .filter((item) => item.clientId === report.clientId && item.fiscalYear === report.fiscalYear && item.id !== report.id)
    .filter((item) => item.workDate < report.workDate || (item.workDate === report.workDate && item.createdAt < report.createdAt))
    .sort((a, b) => `${b.workDate}-${b.createdAt}`.localeCompare(`${a.workDate}-${a.createdAt}`))[0];
}

export function calculateAutoWorkCount(reports: DailyReport[], report: DailyReport) {
  const previous = findPreviousReport(reports, report);
  if (!previous) return report.manualCount + report.smartImportCount;
  return Math.max(report.totalSortingCount - previous.totalSortingCount, 0);
}

function amountByUnit(quantity: number, price: Pick<UnitPrice, "amount" | "quantity">) {
  return Math.round((quantity / price.quantity) * price.amount);
}

function costByUnit(quantity: number, price: Pick<UnitPrice, "costAmount" | "quantity">) {
  return Math.round((quantity / price.quantity) * price.costAmount);
}

function outsourceByUnit(quantity: number, price: Pick<UnitPrice, "outsourceAmount" | "quantity">) {
  return Math.round((quantity / price.quantity) * price.outsourceAmount);
}

function outsourceAmount(quantity: number, unitPrice: number, unitQuantity = 1) {
  return Math.round((quantity / unitQuantity) * unitPrice);
}

function workerOutsourcePrice(data: AppData, workerId: string): WorkerOutsourcePrice {
  return (
    data.workerOutsourcePrices.find((price) => price.workerId === workerId) ?? {
      workerId,
      manualUnitPrice: 40,
      smartUnitPrice: 20,
      submittedDocumentsUnitPrice: 1000,
      officeWorkUnitPrice: 300,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  );
}

export function calculateSortingBillableCounts(manualCount: number, smartImportCount: number, freeLimit = FREE_MANUAL_ALLOWANCE) {
  const manualFreeUsed = Math.min(manualCount, freeLimit);
  const manualBillable = Math.max(manualCount - freeLimit, 0);
  const remainingFreeLimit = Math.max(freeLimit - manualCount, 0);
  const smartFreeUsed = Math.min(smartImportCount, remainingFreeLimit);
  const smartBillable = Math.max(smartImportCount - remainingFreeLimit, 0);

  return { manualFreeUsed, manualBillable, smartFreeUsed, smartBillable };
}

function allocateSortingBillable(reports: DailyReport[]) {
  const reportsByClient = new Map<string, DailyReport[]>();
  const manualFreeByReport = new Map<string, number>();
  const manualBillableByReport = new Map<string, number>();
  const smartBillableByReport = new Map<string, number>();
  const smartFreeByReport = new Map<string, number>();

  reports.forEach((report) => {
    const clientReports = reportsByClient.get(report.clientId) ?? [];
    clientReports.push(report);
    reportsByClient.set(report.clientId, clientReports);
  });

  reportsByClient.forEach((clientReports) => {
    const sortedReports = clientReports.slice().sort((a, b) => `${a.workDate}-${a.createdAt}-${a.id}`.localeCompare(`${b.workDate}-${b.createdAt}-${b.id}`));
    let remainingFree = FREE_MANUAL_ALLOWANCE;

    sortedReports.forEach((report) => {
      const manualFreeUsed = Math.min(remainingFree, report.manualCount);
      manualFreeByReport.set(report.id, manualFreeUsed);
      manualBillableByReport.set(report.id, Math.max(report.manualCount - manualFreeUsed, 0));
      remainingFree = Math.max(remainingFree - manualFreeUsed, 0);
    });

    sortedReports.forEach((report) => {
      const smartFreeUsed = Math.min(remainingFree, report.smartImportCount);
      smartFreeByReport.set(report.id, smartFreeUsed);
      smartBillableByReport.set(report.id, Math.max(report.smartImportCount - smartFreeUsed, 0));
      remainingFree = Math.max(remainingFree - smartFreeUsed, 0);
    });
  });

  return { manualFreeByReport, manualBillableByReport, smartBillableByReport, smartFreeByReport };
}

export function buildMonthlySummary(data: AppData, month: string) {
  const monthlyReports = data.reports.filter((report) => report.workMonth === month);
  const { manualFreeByReport, manualBillableByReport, smartBillableByReport, smartFreeByReport } = allocateSortingBillable(monthlyReports);
  const workerNames = new Map(data.workers.map((worker) => [worker.id, worker.name]));
  const clientNames = new Map(data.clients.map((client) => [client.id, client.name]));
  const manualPrice = data.sortingUnitPrices.find((price) => price.id === "manual") ?? { amount: 60, costAmount: 40 };
  const smartPrice = data.sortingUnitPrices.find((price) => price.id === "smart") ?? { amount: 40, costAmount: 0 };
  const rowMap = new Map<string, SummaryRow>();
  const clientMap = new Map<string, ClientSummaryRow>();
  const fiscalYearLabelsByRowKey = new Map<string, Set<string>>();
  const fiscalYearLabelsByClient = new Map<string, Set<string>>();

  monthlyReports.forEach((report) => {
    const key = `${report.workerId}-${report.clientId}`;
    const row =
      rowMap.get(key) ??
      {
        key,
        workerId: report.workerId,
        workerName: workerNames.get(report.workerId) ?? "未設定",
        clientId: report.clientId,
        clientName: clientNames.get(report.clientId) ?? "未設定",
        manualCount: 0,
        manualFreeAppliedCount: 0,
        manualBillableCount: 0,
        smartImportCount: 0,
        smartBillableCount: 0,
        smartFreeAppliedCount: 0,
        invoiceTargetCount: 0,
        autoWorkCount: 0,
        fiscalYearLabels: ""
      };
    const manualFreeApplied = manualFreeByReport.get(report.id) ?? 0;
    const billable = manualBillableByReport.get(report.id) ?? 0;
    const smartBillable = smartBillableByReport.get(report.id) ?? report.smartImportCount;
    const smartFreeApplied = smartFreeByReport.get(report.id) ?? 0;
    row.manualCount += report.manualCount;
    row.manualFreeAppliedCount += manualFreeApplied;
    row.manualBillableCount += billable;
    row.smartImportCount += report.smartImportCount;
    row.smartBillableCount += smartBillable;
    row.smartFreeAppliedCount += smartFreeApplied;
    row.invoiceTargetCount += billable + smartBillable;
    row.autoWorkCount += calculateAutoWorkCount(data.reports, report);
    const rowLabels = fiscalYearLabelsByRowKey.get(key) ?? new Set<string>();
    rowLabels.add(report.fiscalYearLabel);
    fiscalYearLabelsByRowKey.set(key, rowLabels);
    row.fiscalYearLabels = Array.from(rowLabels).sort().join(" / ");
    rowMap.set(key, row);

    const clientRow =
      clientMap.get(report.clientId) ??
      {
        clientId: report.clientId,
        clientName: clientNames.get(report.clientId) ?? "未設定",
        manualCount: 0,
        manualFreeCount: 0,
        manualFreeAppliedCount: 0,
        manualBillableCount: 0,
        manualRevenueUnitPrice: manualPrice.amount,
        manualRevenue: 0,
        manualCostUnitPrice: manualPrice.costAmount,
        manualCost: 0,
        smartImportCount: 0,
        smartBillableCount: 0,
        smartFreeAppliedCount: 0,
        smartRevenueUnitPrice: smartPrice.amount,
        smartRevenue: 0,
        smartCostUnitPrice: smartPrice.costAmount,
        smartCost: 0,
        invoiceTargetCount: 0,
        sortingRevenue: 0,
        sortingCost: 0,
        sortingGrossProfit: 0,
        manualOutsourceCost: 0,
        smartOutsourceCost: 0,
        sortingOutsourceCost: 0,
        fiscalYearLabels: ""
      };
    const clientLabels = fiscalYearLabelsByClient.get(report.clientId) ?? new Set<string>();
    clientLabels.add(report.fiscalYearLabel);
    fiscalYearLabelsByClient.set(report.clientId, clientLabels);
    clientRow.fiscalYearLabels = Array.from(clientLabels).sort().join(" / ");
    const outsourcePrice = workerOutsourcePrice(data, report.workerId);
    clientRow.manualCount += report.manualCount;
    clientRow.manualFreeAppliedCount += manualFreeApplied;
    clientRow.manualBillableCount += billable;
    clientRow.smartImportCount += report.smartImportCount;
    clientRow.smartBillableCount += smartBillable;
    clientRow.smartFreeAppliedCount += smartFreeApplied;
    clientRow.manualFreeCount = clientRow.manualFreeAppliedCount + clientRow.smartFreeAppliedCount;
    clientRow.invoiceTargetCount = clientRow.manualBillableCount + clientRow.smartBillableCount;
    clientRow.manualRevenue = clientRow.manualBillableCount * manualPrice.amount;
    clientRow.manualCost = clientRow.manualCount * manualPrice.costAmount;
    clientRow.smartRevenue = clientRow.smartBillableCount * smartPrice.amount;
    clientRow.smartCost = clientRow.smartImportCount * smartPrice.costAmount;
    clientRow.sortingRevenue = clientRow.manualRevenue + clientRow.smartRevenue;
    clientRow.sortingCost = clientRow.manualCost + clientRow.smartCost;
    clientRow.manualOutsourceCost += report.manualCount * outsourcePrice.manualUnitPrice;
    clientRow.smartOutsourceCost += report.smartImportCount * outsourcePrice.smartUnitPrice;
    clientRow.sortingOutsourceCost = clientRow.manualOutsourceCost + clientRow.smartOutsourceCost;
    clientRow.sortingGrossProfit = clientRow.sortingRevenue - clientRow.sortingCost;
    clientMap.set(report.clientId, clientRow);
  });

  return {
    rows: Array.from(rowMap.values()).sort((a, b) => `${a.clientName}-${a.workerName}`.localeCompare(`${b.clientName}-${b.workerName}`, "ja")),
    clientRows: Array.from(clientMap.values()).sort((a, b) => a.clientName.localeCompare(b.clientName, "ja")),
    reports: monthlyReports
  };
}

export function calculateMonthlyWorkAmount(report: Pick<MonthlyWorkReport, "workTypeId" | "documentCount" | "workMinutes">, data: AppData) {
  const price = data.unitPrices.find((item) => item.workTypeId === report.workTypeId);
  const workType = data.workTypes.find((item) => item.id === report.workTypeId);
  if (!price || !workType) return 0;
  const quantity = workType.unit === "count" ? report.documentCount : report.workMinutes;
  return amountByUnit(quantity, price);
}

export function buildMonthlyWorkSummary(data: AppData, month: string) {
  const clientNames = new Map(data.clients.map((client) => [client.id, client.name]));
  const workTypes = new Map(data.workTypes.map((workType) => [workType.id, workType]));
  const prices = new Map(data.unitPrices.map((price) => [price.workTypeId, price]));
  const reports = data.monthlyWorkReports.filter((report) => report.workMonth === month);
  const rowMap = new Map<string, MonthlyWorkSummaryRow>();

  reports.forEach((report) => {
    const workType = workTypes.get(report.workTypeId);
    const price = prices.get(report.workTypeId);
    if (!workType || !price) return;

    const key = `${report.clientId}-${report.workTypeId}`;
    const row =
      rowMap.get(key) ??
      {
        key,
        clientId: report.clientId,
        clientName: clientNames.get(report.clientId) ?? "未設定",
        workTypeId: report.workTypeId,
        workTypeName: workType.name,
        unit: workType.unit,
        documentCount: 0,
        workMinutes: 0,
        revenueUnitPrice: price.amount,
        costUnitPrice: price.costAmount,
        outsourceUnitPrice: price.outsourceAmount,
        unitQuantity: price.quantity,
        unitLabel: price.unitLabel,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        outsourceCost: 0
      };

    row.documentCount += report.documentCount;
    row.workMinutes += report.workMinutes;
    const quantity = workType.unit === "count" ? row.documentCount : row.workMinutes;
    row.revenue = amountByUnit(quantity, price);
    row.cost = costByUnit(quantity, price);
    row.outsourceCost = outsourceByUnit(quantity, price);
    row.grossProfit = row.revenue - row.outsourceCost;
    rowMap.set(key, row);
  });

  const rows = Array.from(rowMap.values()).sort((a, b) => `${a.clientName}-${a.workTypeName}`.localeCompare(`${b.clientName}-${b.workTypeName}`, "ja"));
  const clientBilling = rows.reduce<ClientBillingRow[]>((list, row) => {
    let client = list.find((item) => item.clientId === row.clientId);
    if (!client) {
      client = { clientId: row.clientId, clientName: row.clientName, rows: [], totalRevenue: 0, totalCost: 0, totalOutsourceCost: 0, grossProfit: 0 };
      list.push(client);
    }
    client.rows.push(row);
    client.totalRevenue += row.revenue;
    client.totalCost += row.cost;
    client.totalOutsourceCost += row.outsourceCost;
    client.grossProfit = client.totalRevenue - client.totalOutsourceCost;
    return list;
  }, []);

  return {
    reports,
    rows,
    clientBilling,
    totals: rows.reduce(
      (sum, row) => ({
        documentCount: sum.documentCount + row.documentCount,
        workMinutes: sum.workMinutes + row.workMinutes,
        revenue: sum.revenue + row.revenue,
        cost: sum.cost + row.cost,
        grossProfit: sum.grossProfit + row.grossProfit
      }),
      { documentCount: 0, workMinutes: 0, revenue: 0, cost: 0, grossProfit: 0 }
    )
  };
}

export function buildOutsourcePaymentSummary(data: AppData, month: string) {
  const workers = new Map(data.workers.map((worker) => [worker.id, worker.name]));
  const clients = new Map(data.clients.map((client) => [client.id, client.name]));
  const workTypes = new Map(data.workTypes.map((workType) => [workType.id, workType]));
  const unitPrices = new Map(data.unitPrices.map((price) => [price.workTypeId, price]));
  const rowMap = new Map<string, WorkerOutsourceSummaryRow>();
  const clientOutsourceMap = new Map<string, { manual: number; smart: number; submitted: number; office: number }>();

  function ensureWorker(workerId: string) {
    const row =
      rowMap.get(workerId) ??
      {
        workerId,
        workerName: workers.get(workerId) ?? "未設定",
        manualCount: 0,
        manualAmount: 0,
        smartImportCount: 0,
        smartImportAmount: 0,
        submittedDocumentsCount: 0,
        submittedDocumentsAmount: 0,
        officeWorkMinutes: 0,
        officeWorkAmount: 0,
        totalAmount: 0,
        details: []
      };
    rowMap.set(workerId, row);
    return row;
  }

  function addClientOutsource(clientId: string, key: "manual" | "smart" | "submitted" | "office", amount: number) {
    const row = clientOutsourceMap.get(clientId) ?? { manual: 0, smart: 0, submitted: 0, office: 0 };
    row[key] += amount;
    clientOutsourceMap.set(clientId, row);
  }

  function addDetail(row: WorkerOutsourceSummaryRow, detail: OutsourceDetailRow) {
    row.details.push(detail);
    row.totalAmount += detail.amount;
  }

  data.reports
    .filter((report) => report.workMonth === month)
    .forEach((report) => {
      const price = workerOutsourcePrice(data, report.workerId);
      const row = ensureWorker(report.workerId);
      const clientName = clients.get(report.clientId) ?? "未設定";

      if (report.manualCount > 0) {
        const amount = report.manualCount * price.manualUnitPrice;
        row.manualCount += report.manualCount;
        row.manualAmount += amount;
        addClientOutsource(report.clientId, "manual", amount);
        addDetail(row, {
          id: `${report.id}-manual`,
          workerId: report.workerId,
          workerName: row.workerName,
          workDate: report.workDate,
          clientName,
          workKind: "手入力",
          quantity: report.manualCount,
          quantityLabel: `${formatNumber(report.manualCount)}件`,
          unitPrice: price.manualUnitPrice,
          amount,
          memo: report.memo
        });
      }

      if (report.smartImportCount > 0) {
        const amount = report.smartImportCount * price.smartUnitPrice;
        row.smartImportCount += report.smartImportCount;
        row.smartImportAmount += amount;
        addClientOutsource(report.clientId, "smart", amount);
        addDetail(row, {
          id: `${report.id}-smart`,
          workerId: report.workerId,
          workerName: row.workerName,
          workDate: report.workDate,
          clientName,
          workKind: "スマート取込",
          quantity: report.smartImportCount,
          quantityLabel: `${formatNumber(report.smartImportCount)}件`,
          unitPrice: price.smartUnitPrice,
          amount,
          memo: report.memo
        });
      }
    });

  data.monthlyWorkReports
    .filter((report) => report.workMonth === month)
    .forEach((report) => {
      const row = ensureWorker(report.workerId);
      const clientName = clients.get(report.clientId) ?? "未設定";
      const workType = workTypes.get(report.workTypeId);
      const price = unitPrices.get(report.workTypeId);
      if (!workType || !price) return;
      if (workType.unit === "count") {
        const amount = outsourceByUnit(report.documentCount, price);
        row.submittedDocumentsCount += report.documentCount;
        row.submittedDocumentsAmount += amount;
        addClientOutsource(report.clientId, "submitted", amount);
        addDetail(row, {
          id: `${report.id}-submitted`,
          workerId: report.workerId,
          workerName: row.workerName,
          workDate: report.workDate,
          clientName,
          workKind: workType.name,
          quantity: report.documentCount,
          quantityLabel: `${formatNumber(report.documentCount)}件`,
          unitPrice: price.outsourceAmount,
          amount,
          memo: report.memo
        });
      } else {
        const amount = outsourceByUnit(report.workMinutes, price);
        row.officeWorkMinutes += report.workMinutes;
        row.officeWorkAmount += amount;
        addClientOutsource(report.clientId, "office", amount);
        addDetail(row, {
          id: `${report.id}-office`,
          workerId: report.workerId,
          workerName: row.workerName,
          workDate: report.workDate,
          clientName,
          workKind: workType.name,
          quantity: report.workMinutes,
          quantityLabel: `${formatNumber(report.workMinutes)}分`,
          unitPrice: price.outsourceAmount,
          amount,
          memo: report.memo
        });
      }
    });

  return {
    rows: Array.from(rowMap.values()).sort((a, b) => a.workerName.localeCompare(b.workerName, "ja")),
    clientOutsource: clientOutsourceMap
  };
}

export function buildClientProfitability(data: AppData, month: string): ClientProfitabilityRow[] {
  const sortingSummary = buildMonthlySummary(data, month);
  const monthlySummary = buildMonthlyWorkSummary(data, month);
  const outsourceSummary = buildOutsourcePaymentSummary(data, month);
  const clientIds = Array.from(new Set([...data.clients.map((client) => client.id), ...sortingSummary.clientRows.map((row) => row.clientId), ...monthlySummary.clientBilling.map((row) => row.clientId)]));

  return clientIds
    .map((clientId) => {
      const clientName = data.clients.find((client) => client.id === clientId)?.name ?? "未設定";
      const sorting = sortingSummary.clientRows.find((row) => row.clientId === clientId);
      const monthly = monthlySummary.clientBilling.find((row) => row.clientId === clientId);
      const submitted = monthly?.rows.find((row) => row.workTypeId === "submitted-documents");
      const office = monthly?.rows.find((row) => row.workTypeId === "office-work");
      const outsource = outsourceSummary.clientOutsource.get(clientId) ?? { manual: 0, smart: 0, submitted: 0, office: 0 };
      const sortingRevenue = sorting?.sortingRevenue ?? 0;
      const submittedDocumentsRevenue = submitted?.revenue ?? 0;
      const officeWorkRevenue = office?.revenue ?? 0;
      const monthlyRevenue = monthly?.totalRevenue ?? 0;
      const totalRevenue = sortingRevenue + monthlyRevenue;
      const totalOutsourceCost = outsource.manual + outsource.smart + outsource.submitted + outsource.office;
      const grossProfit = totalRevenue - totalOutsourceCost;
      return {
        clientId,
        clientName,
        sortingRevenue,
        submittedDocumentsRevenue,
        officeWorkRevenue,
        totalRevenue,
        manualOutsourceCost: outsource.manual,
        smartOutsourceCost: outsource.smart,
        submittedDocumentsOutsourceCost: outsource.submitted,
        officeWorkOutsourceCost: outsource.office,
        totalOutsourceCost,
        grossProfit,
        grossProfitRate: totalRevenue ? (grossProfit / totalRevenue) * 100 : 0,
        sortingDetail: sorting
      };
    })
    .filter((row) => row.totalRevenue > 0 || row.totalOutsourceCost > 0)
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "ja"));
}

export function unitLabel(workType: WorkType) {
  return workType.unit === "count" ? "件数" : "時間";
}
