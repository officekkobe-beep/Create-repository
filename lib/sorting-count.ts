export type SortingCountKey = "totalSortingCount" | "manualCount" | "smartImportCount";

export type SortingCountState = {
  inputs: Record<SortingCountKey, string>;
  manual: Record<SortingCountKey, boolean>;
  autoField: SortingCountKey | null;
  warning: string;
};

export function emptySortingCountState(): SortingCountState {
  return {
    inputs: { totalSortingCount: "", manualCount: "", smartImportCount: "" },
    manual: { totalSortingCount: false, manualCount: false, smartImportCount: false },
    autoField: null,
    warning: ""
  };
}

export function sortingCountStateFromValues(values: { totalSortingCount: number; manualCount: number; smartImportCount: number }): SortingCountState {
  return {
    inputs: {
      totalSortingCount: String(values.totalSortingCount),
      manualCount: String(values.manualCount),
      smartImportCount: String(values.smartImportCount)
    },
    manual: { totalSortingCount: true, manualCount: true, smartImportCount: true },
    autoField: null,
    warning: ""
  };
}

export function parseCountInput(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCountInput(value: string) {
  if (value.trim() === "") return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return String(Math.max(0, Math.floor(parsed)));
}

export function valuesFromCountInputs(inputs: Record<SortingCountKey, string>) {
  return {
    totalSortingCount: parseCountInput(inputs.totalSortingCount) ?? 0,
    manualCount: parseCountInput(inputs.manualCount) ?? 0,
    smartImportCount: parseCountInput(inputs.smartImportCount) ?? 0
  };
}

export function calculateSortingCountState(state: SortingCountState, previousTotal?: number): SortingCountState {
  const keys: SortingCountKey[] = ["totalSortingCount", "manualCount", "smartImportCount"];
  const manualFilled = keys.filter((key) => state.manual[key] && parseCountInput(state.inputs[key]) !== null);
  const next: SortingCountState = { ...state, inputs: { ...state.inputs }, manual: { ...state.manual }, autoField: null, warning: "" };
  const previous = previousTotal ?? 0;

  if (manualFilled.length < 2) {
    if (state.autoField && !next.manual[state.autoField]) next.inputs[state.autoField] = "";
    return next;
  }

  if (manualFilled.length >= 3) {
    const total = parseCountInput(next.inputs.totalSortingCount);
    const manual = parseCountInput(next.inputs.manualCount);
    const smart = parseCountInput(next.inputs.smartImportCount);
    if (total !== null && manual !== null && smart !== null && total - previous < 0) {
      next.warning = "入力値を確認してください。計算結果がマイナスになります";
    } else if (total !== null && manual !== null && smart !== null && total - previous !== manual + smart) {
      next.warning = "今回作業件数と、手入力件数＋スマート取込件数が一致していません";
    }
    return next;
  }

  const target = keys.find((key) => !manualFilled.includes(key));
  if (!target) return next;

  const total = parseCountInput(next.inputs.totalSortingCount);
  const manual = parseCountInput(next.inputs.manualCount);
  const smart = parseCountInput(next.inputs.smartImportCount);
  let calculated = 0;

  if (target === "manualCount" && total !== null && smart !== null) calculated = total - previous - smart;
  if (target === "smartImportCount" && total !== null && manual !== null) calculated = total - previous - manual;
  if (target === "totalSortingCount" && manual !== null && smart !== null) calculated = previous + manual + smart;

  if (calculated < 0) {
    if (!next.manual[target]) next.inputs[target] = "";
    next.warning = "入力値を確認してください。計算結果がマイナスになります";
    return next;
  }

  next.inputs[target] = String(calculated);
  next.manual[target] = false;
  next.autoField = target;
  return next;
}
