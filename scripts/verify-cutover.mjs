// 切替後の確認スクリプト（読み取りと「0件を対象とする削除」だけを行い、データは変更しない）。
// 秘密値・データ行は出力しない。結果は PASS / FAIL / WARN / SKIP のみ。
//
// 使い方（PowerShell 例）:
//   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="..."; $env:APP_URL="https://create-repository.vercel.app"
//   $env:OLD_WORKER_TOKEN="（任意: 失効させた旧リンクのトークン）"; $env:CRON_SECRET="（任意）"
//   node scripts/verify-cutover.mjs

const TABLES = [
  ["workers", "id"], ["clients", "id"], ["daily_reports", "id"], ["work_types", "id"], ["unit_prices", "work_type_id"],
  ["sorting_unit_prices", "id"], ["worker_outsource_prices", "worker_id"], ["worker_work_type_outsource_prices", "id"],
  ["worker_share_links", "worker_id"], ["monthly_work_reports", "id"], ["payment_statement_settings", "id"],
  ["backup_records", "id"], ["monthly_closings", "id"], ["audit_logs", "id"]
];

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const appUrl = process.env.APP_URL;
let failed = 0;

function report(status, label, detail = "") {
  if (status === "FAIL") failed += 1;
  console.log(`${status.padEnd(4)} ${label}${detail ? ` (${detail})` : ""}`);
}

async function checkTable(table, keyColumn) {
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  const select = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${keyColumn}&limit=1`, { headers });
  if (select.status === 401 || select.status === 403) {
    report("PASS", `anon SELECT ${table} 拒否`, String(select.status));
  } else if (select.ok) {
    const rows = await select.json().catch(() => []);
    report(Array.isArray(rows) && rows.length === 0 ? "WARN" : "FAIL", `anon SELECT ${table}`, `HTTP ${select.status}, ${Array.isArray(rows) ? rows.length : "?"}件取得`);
  } else {
    report("WARN", `anon SELECT ${table}`, `HTTP ${select.status}`);
  }

  // 存在しないIDを条件にした削除（許可されていても0件）。権限があるかどうかだけを確認する。
  const remove = await fetch(`${supabaseUrl}/rest/v1/${table}?${keyColumn}=eq.__verify_cutover_nonexistent__`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
  report(remove.status === 401 || remove.status === 403 ? "PASS" : "FAIL", `anon DELETE ${table} 拒否`, `HTTP ${remove.status}`);
}

async function checkApp() {
  const data = await fetch(`${appUrl}/api/admin/data`, { cache: "no-store" });
  report(data.status === 401 ? "PASS" : "FAIL", "未ログインで管理者データAPIを拒否", `HTTP ${data.status}`);

  const command = await fetch(`${appUrl}/api/admin/commands/report.delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: appUrl },
    body: JSON.stringify({ args: { id: "__verify_cutover_nonexistent__" } })
  });
  report(command.status === 401 ? "PASS" : "FAIL", "未ログインで管理者保存APIを拒否", `HTTP ${command.status}`);

  const page = await fetch(`${appUrl}/`, { redirect: "manual" });
  const location = page.headers.get("location") ?? "";
  report(page.status >= 300 && page.status < 400 && location.includes("/login") ? "PASS" : "FAIL", "未ログインで管理画面をログイン画面へ移動", `HTTP ${page.status}`);

  const randomToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const unknown = await fetch(`${appUrl}/api/worker/${randomToken}`, { cache: "no-store" });
  report(unknown.status === 404 ? "PASS" : "FAIL", "未知の外注者リンクを拒否", `HTTP ${unknown.status}`);

  if (process.env.OLD_WORKER_TOKEN) {
    const old = await fetch(`${appUrl}/api/worker/${encodeURIComponent(process.env.OLD_WORKER_TOKEN)}`, { cache: "no-store" });
    report(old.status === 404 ? "PASS" : "FAIL", "旧外注者リンクを拒否", `HTTP ${old.status}`);
  } else {
    report("SKIP", "旧外注者リンクの拒否", "OLD_WORKER_TOKEN 未指定");
  }

  const cronHeaders = process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
  const cron = await fetch(`${appUrl}/api/cron/keep-alive`, { headers: cronHeaders, cache: "no-store" });
  report(cron.ok ? "PASS" : "FAIL", "キープアライブCronがサーバー鍵で動作", `HTTP ${cron.status}`);
}

if (!supabaseUrl || !anonKey) {
  report("SKIP", "DB直接アクセスの確認", "SUPABASE_URL / SUPABASE_ANON_KEY 未指定");
} else {
  for (const [table, keyColumn] of TABLES) await checkTable(table, keyColumn);
}
if (!appUrl) {
  report("SKIP", "アプリの確認", "APP_URL 未指定");
} else {
  await checkApp();
}
console.log(failed ? `\n不合格: ${failed}件` : "\n不合格なし");
process.exit(failed ? 1 : 0);
