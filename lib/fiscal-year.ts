export const DEFAULT_CLOSING_MONTH = 3;

export function normalizeClosingMonth(closingMonth: number | undefined | null) {
  const value = Number(closingMonth);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : DEFAULT_CLOSING_MONTH;
}

export function fiscalStartMonth(closingMonth: number | undefined | null) {
  return (normalizeClosingMonth(closingMonth) % 12) + 1;
}

export function fiscalYearFromDate(workDate: string, closingMonth: number | undefined | null) {
  const normalized = normalizeClosingMonth(closingMonth);
  const [yearStr, monthStr] = (workDate ?? "").split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return new Date().getFullYear();
  return month <= normalized ? year - 1 : year;
}

export function fiscalYearLabel(fiscalYear: number) {
  return `${fiscalYear}年度`;
}

export function fiscalYearOptions(autoYear: number, currentYear?: number) {
  const years = new Set([autoYear - 1, autoYear, autoYear + 1]);
  if (typeof currentYear === "number" && Number.isInteger(currentYear)) years.add(currentYear);
  return Array.from(years)
    .sort((a, b) => a - b)
    .map((year) => ({ value: year, label: fiscalYearLabel(year) }));
}
