"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { findPreviousReport, formatNumber, monthFromDate } from "@/lib/calculations";
import {
  calculateSortingCountState,
  emptySortingCountState,
  normalizeCountInput,
  parseCountInput,
  valuesFromCountInputs,
  type SortingCountKey,
  type SortingCountState
} from "@/lib/sorting-count";
import { fetchData, isMonthClosed, upsertMonthlyWorkReport, upsertReport } from "@/lib/storage";
import type { AppData, MonthlyWorkReportInput, ReportInput, Worker } from "@/lib/types";
import { SupabaseConnectionProblemPanel } from "@/components/SupabaseConnectionProblemPanel";
import { fiscalStartMonth, fiscalYearFromDate, fiscalYearOptions, normalizeClosingMonth } from "@/lib/fiscal-year";

type WorkKind = "sorting" | string;
type ConfirmKind = "sorting" | "monthly" | null;

const emptyData: AppData = {
  workers: [],
  clients: [],
  reports: [],
  workTypes: [],
  unitPrices: [],
  sortingUnitPrices: [],
  workerOutsourcePrices: [],
  workerShareLinks: [],
  paymentStatementSettings: {
    title: "",
    issuerName: "",
    issuerAddress: "",
    issuerPhone: "",
    issuerEmail: "",
    registrationNumber: "",
    paymentDueText: "",
    bankFeeText: "",
    notes: "",
    footerText: "",
    updatedAt: ""
  },
  monthlyWorkReports: [],
  monthlyClosings: [],
  backupRecords: [],
  auditLogs: []
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function displayMemo(memo: string) {
  return memo.trim() || "なし";
}

function clientClosingMonth(data: AppData, clientId: string) {
  return normalizeClosingMonth(data.clients.find((client) => client.id === clientId)?.closingMonth);
}

function blankSorting(workerId: string, data: AppData): ReportInput {
  const workDate = todayDate();
  const clientId = data.clients.find((client) => client.active)?.id ?? "";
  return {
    workDate,
    workerId,
    clientId,
    manualCount: 0,
    smartImportCount: 0,
    totalSortingCount: 0,
    memo: "",
    source: "worker_link",
    sourceWorkerId: workerId,
    fiscalYear: fiscalYearFromDate(workDate, clientClosingMonth(data, clientId))
  };
}

function blankMonthly(workerId: string, data: AppData, kind: WorkKind): MonthlyWorkReportInput {
  const workTypeId = kind !== "sorting" ? kind : data.workTypes.find((workType) => workType.active)?.id ?? "";
  return {
    workDate: todayDate(),
    workerId,
    workTypeId,
    clientId: data.clients.find((client) => client.active)?.id ?? "",
    documentCount: 0,
    workMinutes: 0,
    memo: "",
    source: "worker_link",
    sourceWorkerId: workerId
  };
}

export default function WorkerInputPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<AppData>(emptyData);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [connectionWarning, setConnectionWarning] = useState("");
  const [workKind, setWorkKind] = useState<WorkKind>("sorting");
  const [sortingForm, setSortingForm] = useState<ReportInput>(blankSorting("", emptyData));
  const [monthlyForm, setMonthlyForm] = useState<MonthlyWorkReportInput>(blankMonthly("", emptyData, "sorting"));
  const [sortingCountState, setSortingCountState] = useState<SortingCountState>(emptySortingCountState());
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);

  useEffect(() => {
    fetchData().then((result) => {
      const link = result.data.workerShareLinks.find((item) => item.token === token && item.active);
      const matchedWorker = link ? result.data.workers.find((item) => item.id === link.workerId && item.active) : undefined;
      setData(result.data);
      setConnectionWarning(result.error ?? "");
      setWorker(matchedWorker ?? null);
      if (matchedWorker) {
        const firstWorkTypeId = result.data.workTypes.find((workType) => workType.active)?.id ?? "sorting";
        setSortingForm(blankSorting(matchedWorker.id, result.data));
        setMonthlyForm(blankMonthly(matchedWorker.id, result.data, firstWorkTypeId));
      }
      setLoading(false);
    });
  }, [token]);

  const previousSorting = useMemo(() => {
    if (!worker || !sortingForm.clientId || !sortingForm.workDate) return undefined;
    return findPreviousReport(data.reports, {
      id: "",
      clientId: sortingForm.clientId,
      workDate: sortingForm.workDate,
      createdAt: new Date().toISOString(),
      fiscalYear: sortingForm.fiscalYear
    });
  }, [data.reports, sortingForm.clientId, sortingForm.workDate, sortingForm.fiscalYear, worker]);
  const previousTotal = previousSorting?.totalSortingCount;
  const selectedWorkType = useMemo(() => data.workTypes.find((workType) => workType.id === monthlyForm.workTypeId), [data.workTypes, monthlyForm.workTypeId]);
  const sortingClosingMonth = clientClosingMonth(data, sortingForm.clientId);
  const sortingFiscalStartMonth = fiscalStartMonth(sortingClosingMonth);
  const sortingAutoFiscalYear = fiscalYearFromDate(sortingForm.workDate, sortingClosingMonth);
  const sortingFiscalYearChoices = fiscalYearOptions(sortingAutoFiscalYear, sortingForm.fiscalYear);

  function changeSortingWorkDate(value: string) {
    setSortingForm({ ...sortingForm, workDate: value, fiscalYear: fiscalYearFromDate(value, sortingClosingMonth) });
  }

  function changeSortingClient(value: string) {
    setSortingForm({ ...sortingForm, clientId: value, fiscalYear: fiscalYearFromDate(sortingForm.workDate, clientClosingMonth(data, value)) });
  }

  useEffect(() => {
    if (workKind !== "sorting") return;
    const recalculated = calculateSortingCountState(sortingCountState, previousTotal);
    if (JSON.stringify(recalculated) === JSON.stringify(sortingCountState)) return;
    setSortingCountState(recalculated);
    setSortingForm((current) => ({ ...current, ...valuesFromCountInputs(recalculated.inputs) }));
  }, [previousTotal, workKind]);

  function notify(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2800);
  }

  function switchKind(kind: WorkKind) {
    if (!worker) return;
    setWorkKind(kind);
    if (kind === "sorting") {
      setSortingForm(blankSorting(worker.id, data));
      setSortingCountState(emptySortingCountState());
      return;
    }
    setMonthlyForm(blankMonthly(worker.id, data, kind));
  }

  function updateSortingCount(field: SortingCountKey, rawValue: string) {
    const normalized = normalizeCountInput(rawValue);
    const calculated = calculateSortingCountState(
      {
        ...sortingCountState,
        inputs: { ...sortingCountState.inputs, [field]: normalized },
        manual: { ...sortingCountState.manual, [field]: normalized !== "" }
      },
      previousTotal
    );
    setSortingCountState(calculated);
    setSortingForm({ ...sortingForm, ...valuesFromCountInputs(calculated.inputs) });
  }

  function validateSorting() {
    const total = parseCountInput(sortingCountState.inputs.totalSortingCount);
    const manual = parseCountInput(sortingCountState.inputs.manualCount);
    const smart = parseCountInput(sortingCountState.inputs.smartImportCount);
    const previous = previousTotal ?? 0;
    if (total === null || manual === null || smart === null) return "総仕訳数、手入力件数、スマート取込件数を入力してください";
    if (total - previous < 0) return "同じ対象年度内で今回総仕訳数が前回総仕訳数を下回っています。対象年度または総仕訳数を確認してください。";
    if (total - previous !== manual + smart) return "今回作業件数と、手入力件数＋スマート取込件数が一致していません";
    return "";
  }

  async function submitSorting(event: FormEvent) {
    event.preventDefault();
    if (!worker) return;
    if (isMonthClosed(data, monthFromDate(sortingForm.workDate))) return notify("この月は月次確定済みのため、作業を登録できません。");
    if (!sortingForm.clientId) return notify("顧問先を選択してください");
    const error = validateSorting();
    if (error) return notify(error);
    setConfirmKind("sorting");
  }

  async function confirmSaveSorting() {
    if (!worker) return;
    const next = await upsertReport({ ...sortingForm, workerId: worker.id, source: "worker_link", sourceWorkerId: worker.id }, data);
    setData(next);
    setSortingForm(blankSorting(worker.id, next));
    setSortingCountState(emptySortingCountState());
    setConfirmKind(null);
    notify("作業を登録しました");
  }

  async function submitMonthly(event: FormEvent) {
    event.preventDefault();
    if (!worker) return;
    if (isMonthClosed(data, monthFromDate(monthlyForm.workDate))) return notify("この月は月次確定済みのため、作業を登録できません。");
    const workType = data.workTypes.find((item) => item.id === workKind);
    if (!workType) return notify("作業種別を選択してください");
    if (!monthlyForm.clientId) return notify("顧問先を選択してください");
    if (workType.unit === "count" && monthlyForm.documentCount <= 0) return notify("数量を入力してください");
    if (workType.unit === "time" && monthlyForm.workMinutes <= 0) return notify("作業時間（分）を入力してください");
    setConfirmKind("monthly");
  }

  async function confirmSaveMonthly() {
    if (!worker) return;
    const workType = data.workTypes.find((item) => item.id === workKind);
    if (!workType) return notify("作業種別を選択してください");
    const next = await upsertMonthlyWorkReport(
      {
        ...monthlyForm,
        workerId: worker.id,
        workTypeId: workType.id,
        documentCount: workType.unit === "count" ? monthlyForm.documentCount : 0,
        workMinutes: workType.unit === "time" ? monthlyForm.workMinutes : 0,
        source: "worker_link",
        sourceWorkerId: worker.id
      },
      data
    );
    setData(next);
    setMonthlyForm(blankMonthly(worker.id, next, workType.id));
    setConfirmKind(null);
    notify("作業を登録しました");
  }

  function sortingPreviewRows() {
    const client = data.clients.find((item) => item.id === sortingForm.clientId);
    return [
      ["作業日", sortingForm.workDate],
      ["顧問先", client?.name ?? "未設定"],
      ["担当者", worker ? `${worker.code} ${worker.name}` : "未設定"],
      ["作業種別", "仕訳作業"],
      ["対象年度", `${sortingForm.fiscalYear}年度`],
      ["決算月", `${sortingClosingMonth}月`],
      ["前回総仕訳数", `${formatNumber(previousTotal ?? 0)}件${previousSorting ? "" : "（初回）"}`],
      ["今回総仕訳数", `${formatNumber(sortingForm.totalSortingCount)}件`],
      ["今回作業件数", `${formatNumber(sortingForm.totalSortingCount - (previousTotal ?? 0))}件`],
      ["手入力件数", `${formatNumber(sortingForm.manualCount)}件`],
      ["スマート取込件数", `${formatNumber(sortingForm.smartImportCount)}件`],
      ["メモ", displayMemo(sortingForm.memo)]
    ];
  }

  function monthlyPreviewRows() {
    const client = data.clients.find((item) => item.id === monthlyForm.clientId);
    const workType = data.workTypes.find((item) => item.id === monthlyForm.workTypeId);
    return [
      ["作業日", monthlyForm.workDate],
      ["顧問先", client?.name ?? "未設定"],
      ["担当者", worker ? `${worker.code} ${worker.name}` : "未設定"],
      ["作業種別", workType?.name ?? "未設定"],
      [workType?.unit === "time" ? "作業時間" : "数量", workType?.unit === "time" ? `${formatNumber(monthlyForm.workMinutes)}分` : `${formatNumber(monthlyForm.documentCount)}件`],
      ["メモ", displayMemo(monthlyForm.memo)]
    ];
  }

  if (loading) return <main className="min-h-screen bg-slate-50 p-5"><div className="mx-auto max-w-md rounded-lg bg-white p-5 text-sm text-slate-600 shadow-soft">読み込み中です。</div></main>;
  if (connectionWarning) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-5">
        <section className="mx-auto max-w-md space-y-4">
          <div className="rounded-xl bg-white p-5 shadow-soft">
            <p className="text-sm font-bold text-red-700">現在入力できません</p>
            <p className="mt-1 text-sm text-slate-600">Supabaseへの接続が回復するまで、この画面からの入力はできません。</p>
          </div>
          <SupabaseConnectionProblemPanel detail={connectionWarning} />
        </section>
      </main>
    );
  }
  if (!worker) return <main className="min-h-screen bg-slate-50 p-5"><div className="mx-auto max-w-md rounded-lg bg-white p-5 text-sm font-semibold text-slate-700 shadow-soft">この入力リンクは現在利用できません</div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5">
      <section className="mx-auto max-w-md rounded-xl bg-white p-5 shadow-soft">
        <div className="mb-5">
          <p className="text-xs font-semibold text-blue-700">外注者用 作業入力</p>
          <h1 className="mt-1 text-2xl font-bold text-ink">作業入力</h1>
        </div>

        {message ? <div className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">{message}</div> : null}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <WorkerChoice active={workKind === "sorting"} onClick={() => switchKind("sorting")} label="仕訳作業" />
          {data.workTypes.filter((workType) => workType.active).map((workType) => (
            <WorkerChoice key={workType.id} active={workKind === workType.id} onClick={() => switchKind(workType.id)} label={workType.name} />
          ))}
        </div>

        {workKind === "sorting" ? (
          <form className="space-y-4" onSubmit={submitSorting}>
            <WorkerDateField value={sortingForm.workDate} onChange={changeSortingWorkDate} />
            <ReadonlyField label="担当者名" value={`${worker.code} ${worker.name}`} />
            <WorkerSelect label="顧問先" value={sortingForm.clientId} onChange={changeSortingClient} options={data.clients.filter((client) => client.active).map((client) => ({ value: client.id, label: client.name }))} />
            <WorkerFiscalYearSelect value={sortingForm.fiscalYear} onChange={(value) => setSortingForm({ ...sortingForm, fiscalYear: value })} options={sortingFiscalYearChoices} />
            <div className="grid grid-cols-2 gap-3">
              <ReadonlyField label="決算月" value={`${sortingClosingMonth}月`} />
              <ReadonlyField label="期首月" value={`${sortingFiscalStartMonth}月`} />
            </div>
            <WorkerNumberField label="総仕訳数" value={sortingCountState.inputs.totalSortingCount} onChange={(value) => updateSortingCount("totalSortingCount", value)} auto={sortingCountState.autoField === "totalSortingCount"} help={<SortingHelp previousTotal={previousTotal} currentTotal={sortingForm.totalSortingCount} />} />
            <WorkerNumberField label="手入力件数" value={sortingCountState.inputs.manualCount} onChange={(value) => updateSortingCount("manualCount", value)} auto={sortingCountState.autoField === "manualCount"} />
            <WorkerNumberField label="スマート取込件数" value={sortingCountState.inputs.smartImportCount} onChange={(value) => updateSortingCount("smartImportCount", value)} auto={sortingCountState.autoField === "smartImportCount"} />
            {sortingCountState.warning ? <div className="rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{sortingCountState.warning}</div> : null}
            <WorkerMemo value={sortingForm.memo} onChange={(value) => setSortingForm({ ...sortingForm, memo: value })} />
            <WorkerSubmit />
          </form>
        ) : (
          <form className="space-y-4" onSubmit={submitMonthly}>
            <WorkerDateField value={monthlyForm.workDate} onChange={(value) => setMonthlyForm({ ...monthlyForm, workDate: value })} />
            <ReadonlyField label="担当者名" value={`${worker.code} ${worker.name}`} />
            <WorkerSelect label="顧問先" value={monthlyForm.clientId} onChange={(value) => setMonthlyForm({ ...monthlyForm, clientId: value })} options={data.clients.filter((client) => client.active).map((client) => ({ value: client.id, label: client.name }))} />
            {selectedWorkType?.unit === "count" ? <PlainNumberField label="数量" value={monthlyForm.documentCount} onChange={(value) => setMonthlyForm({ ...monthlyForm, documentCount: value })} /> : <PlainNumberField label="作業時間（分）" value={monthlyForm.workMinutes} onChange={(value) => setMonthlyForm({ ...monthlyForm, workMinutes: value })} />}
            <WorkerMemo value={monthlyForm.memo} onChange={(value) => setMonthlyForm({ ...monthlyForm, memo: value })} />
            <WorkerSubmit />
          </form>
        )}
      </section>
      {confirmKind ? (
        <WorkerConfirmModal
          rows={confirmKind === "sorting" ? sortingPreviewRows() : monthlyPreviewRows()}
          onCancel={() => setConfirmKind(null)}
          onConfirm={confirmKind === "sorting" ? confirmSaveSorting : confirmSaveMonthly}
        />
      ) : null}
    </main>
  );
}

function WorkerChoice({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`rounded-md px-2 py-3 text-xs font-bold ${active ? "bg-ink text-white" : "border border-line bg-white text-slate-700"}`} onClick={onClick}>{label}</button>;
}

function WorkerField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>{children}</label>;
}

function WorkerDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <WorkerField label="作業日"><input className="field py-3 text-base" type="date" required value={value} onChange={(event) => onChange(event.target.value)} /><span className="mt-1 block text-xs text-slate-500">作業月: {monthFromDate(value)}</span></WorkerField>;
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return <WorkerField label={label}><div className="rounded-md border border-line bg-slate-50 px-3 py-3 text-base font-semibold">{value}</div></WorkerField>;
}

function WorkerSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <WorkerField label={label}><select className="field py-3 text-base" required value={value} onChange={(event) => onChange(event.target.value)}><option value="">選択してください</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></WorkerField>;
}

function WorkerFiscalYearSelect({ value, onChange, options }: { value: number; onChange: (value: number) => void; options: { value: number; label: string }[] }) {
  return <WorkerField label="対象年度"><select className="field py-3 text-base" value={value} onChange={(event) => onChange(Number(event.target.value))}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></WorkerField>;
}

function WorkerNumberField({ label, value, onChange, auto, help }: { label: string; value: string; onChange: (value: string) => void; auto: boolean; help?: React.ReactNode }) {
  return <WorkerField label={label}><input className={`field py-3 text-base ${auto ? "border-blue-300 bg-blue-50" : ""}`} type="number" min="0" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />{auto && value !== "" ? <span className="mt-1 block text-xs font-semibold text-blue-700">{formatNumber(Number(value))}件（自動計算）</span> : null}{help ? <span className="mt-1 block text-xs text-slate-500">{help}</span> : null}</WorkerField>;
}

function PlainNumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <WorkerField label={label}><input className="field py-3 text-base" type="number" min="0" inputMode="numeric" value={value} onChange={(event) => onChange(Number(event.target.value))} /></WorkerField>;
}

function SortingHelp({ previousTotal, currentTotal }: { previousTotal?: number; currentTotal: number }) {
  if (previousTotal === undefined) return <>前回総仕訳数：0件（初回） ／ 今回作業件数：{formatNumber(currentTotal)}件</>;
  return <>前回総仕訳数：{formatNumber(previousTotal)}件 ／ 今回作業件数：{formatNumber(currentTotal - previousTotal)}件</>;
}

function WorkerMemo({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <WorkerField label="メモ"><textarea className="field min-h-28 py-3 text-base" value={value} onChange={(event) => onChange(event.target.value)} /></WorkerField>;
}

function WorkerSubmit() {
  return <button className="w-full rounded-lg bg-brand px-4 py-4 text-base font-bold text-white shadow-sm" type="submit">保存</button>;
}

function WorkerConfirmModal({ rows, onCancel, onConfirm }: { rows: string[][]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
      <section className="max-h-[90vh] w-full max-w-md overflow-hidden rounded-xl bg-white shadow-soft">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-xl font-bold">入力内容の確認</h2>
          <p className="mt-1 text-sm text-slate-500">内容を確認してから登録してください。</p>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-5">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="border-b border-line last:border-b-0">
                  <th className="w-32 bg-slate-50 px-3 py-3 text-left font-bold text-slate-600">{label}</th>
                  <td className="px-3 py-3 font-semibold text-ink">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 border-t border-line px-5 py-4">
          <button className="button-primary w-full" type="button" onClick={onConfirm}>この内容で保存</button>
          <button className="button-secondary w-full" type="button" onClick={onCancel}>修正する</button>
        </div>
      </section>
    </div>
  );
}
