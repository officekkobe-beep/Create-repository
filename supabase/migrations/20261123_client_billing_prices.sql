-- 顧問先別単価・今回限りの単価・保存時の単価記録（追加のみ）
-- 2026-11-23
--
-- ・既存のテーブル・列・データは変更も削除もしません（列とテーブルを「追加」するだけです）。
-- ・何度実行しても同じ結果になります（2回目以降は何も起きません）。
-- ・既存の作業日報には単価を書き込みません（旧データは従来どおりの計算のまま）。
-- ・権限（RLS）は既存テーブルと同じ設定にしています（セキュリティ設定は変更しません）。

begin;

-- 1) 作業種別：時間単価の「何分あたり」か（空欄＝従来どおり10分）
alter table work_types add column if not exists billing_unit_minutes integer
  check (billing_unit_minutes is null or billing_unit_minutes > 0);

-- 2) 顧問先：包括契約の範囲などのメモ（任意）
alter table clients add column if not exists billing_scope_memo text not null default '';

-- 3) 顧問先×作業種別の個別の売上単価（行が無い＝未設定。0円は有効な単価）
create table if not exists client_work_type_billing_prices (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  work_type_id text not null references work_types(id) on delete restrict,
  unit_price integer not null check (unit_price >= 0),
  unit_minutes integer check (unit_minutes is null or unit_minutes > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists client_work_type_billing_prices_unique_idx
  on client_work_type_billing_prices(client_id, work_type_id);

-- 4) 月次作業の日報：保存時に適用した売上単価の記録
alter table monthly_work_reports add column if not exists billed_unit_price integer
  check (billed_unit_price is null or billed_unit_price >= 0);
alter table monthly_work_reports add column if not exists billed_unit_quantity integer
  check (billed_unit_quantity is null or billed_unit_quantity > 0);
alter table monthly_work_reports add column if not exists billed_price_source text
  check (billed_price_source is null or billed_price_source in ('standard', 'client', 'override'));
alter table monthly_work_reports add column if not exists billing_override_reason text not null default '';

-- 5) 権限：既存テーブルと同じ設定
alter table client_work_type_billing_prices enable row level security;
drop policy if exists "client_work_type_billing_prices_select" on client_work_type_billing_prices;
drop policy if exists "client_work_type_billing_prices_insert" on client_work_type_billing_prices;
drop policy if exists "client_work_type_billing_prices_update" on client_work_type_billing_prices;
drop policy if exists "client_work_type_billing_prices_delete" on client_work_type_billing_prices;
create policy "client_work_type_billing_prices_select" on client_work_type_billing_prices for select using (true);
create policy "client_work_type_billing_prices_insert" on client_work_type_billing_prices for insert with check (true);
create policy "client_work_type_billing_prices_update" on client_work_type_billing_prices for update using (true) with check (true);
create policy "client_work_type_billing_prices_delete" on client_work_type_billing_prices for delete using (true);
grant select, insert, update, delete on client_work_type_billing_prices to anon, authenticated;

-- 6) アプリがすぐ新しい列を使えるよう、APIの定義を読み直す
notify pgrst, 'reload schema';

commit;

-- 確認用（結果が1行出ればOK）:
-- select count(*) as client_prices from client_work_type_billing_prices;
