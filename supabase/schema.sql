-- 注意: このファイルは公開キー（anon）からのアクセスを遮断する設定を含む（末尾の「公開アクセスの遮断」）。
-- 管理画面・外注者画面がサーバーAPI経由になったアプリ（PR-3以降）がデプロイされる前に実行すると、旧アプリは動かなくなる。
-- 全行を許可するポリシーはもう作らない。再実行しても公開状態には戻らない。

create extension if not exists pgcrypto;

create table if not exists workers (
  id text primary key,
  worker_code text not null default '',
  name text not null,
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists clients (
  id text primary key,
  name text not null,
  code text not null default '',
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists daily_reports (
  id text primary key,
  work_date date not null,
  work_month text not null,
  worker_id text not null references workers(id) on delete restrict,
  client_id text not null references clients(id) on delete restrict,
  manual_count integer not null default 0 check (manual_count >= 0),
  smart_import_count integer not null default 0 check (smart_import_count >= 0),
  total_sorting_count integer not null default 0 check (total_sorting_count >= 0),
  memo text not null default '',
  source text not null default 'admin' check (source in ('admin', 'worker_link')),
  source_worker_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists work_types (
  id text primary key,
  work_type_code text not null default '',
  name text not null,
  unit text not null check (unit in ('count', 'time')),
  unit_type text not null default 'count' check (unit_type in ('count', 'time')),
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists unit_prices (
  work_type_id text primary key references work_types(id) on delete restrict,
  amount integer not null check (amount >= 0),
  cost_amount integer not null default 0 check (cost_amount >= 0),
  outsource_amount integer not null default 0 check (outsource_amount >= 0),
  outsource_unit_price integer not null default 0 check (outsource_unit_price >= 0),
  quantity integer not null check (quantity > 0),
  unit_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sorting_unit_prices (
  id text primary key check (id in ('manual', 'smart')),
  name text not null,
  amount integer not null check (amount >= 0),
  cost_amount integer not null default 0 check (cost_amount >= 0),
  quantity integer not null check (quantity > 0),
  unit_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table unit_prices add column if not exists cost_amount integer not null default 0 check (cost_amount >= 0);
alter table unit_prices add column if not exists outsource_amount integer not null default 0 check (outsource_amount >= 0);
alter table unit_prices add column if not exists outsource_unit_price integer not null default 0 check (outsource_unit_price >= 0);
alter table sorting_unit_prices add column if not exists cost_amount integer not null default 0 check (cost_amount >= 0);
alter table workers add column if not exists worker_code text not null default '';
alter table workers add column if not exists is_active boolean not null default true;
alter table clients add column if not exists is_active boolean not null default true;
alter table clients add column if not exists closing_month integer not null default 3 check (closing_month >= 1 and closing_month <= 12);
alter table work_types add column if not exists work_type_code text not null default '';
alter table work_types add column if not exists unit_type text not null default 'count' check (unit_type in ('count', 'time'));
alter table work_types add column if not exists is_active boolean not null default true;

-- 前年度・新年度の並行入力対応: daily_reports に対象年度関連の列を追加する。
-- NOT NULLやDEFAULTを付けず、既存データはNULLのままバックフィルの対象として扱う。
alter table daily_reports add column if not exists fiscal_year integer;
alter table daily_reports add column if not exists fiscal_year_label text;
alter table daily_reports add column if not exists client_closing_month integer check (client_closing_month >= 1 and client_closing_month <= 12);
alter table daily_reports add column if not exists client_fiscal_start_month integer check (client_fiscal_start_month >= 1 and client_fiscal_start_month <= 12);
alter table daily_reports add column if not exists previous_total_journal_count integer check (previous_total_journal_count >= 0);
alter table daily_reports add column if not exists current_total_journal_count integer check (current_total_journal_count >= 0);

-- 既存データの対象年度を、作業日と顧問先の決算月から補完する（NULLの行だけを対象にした非破壊的なバックフィル）。
update daily_reports d
set client_closing_month = coalesce(c.closing_month, 3)
from clients c
where c.id = d.client_id and d.client_closing_month is null;

update daily_reports
set client_closing_month = 3
where client_closing_month is null;

update daily_reports
set client_fiscal_start_month = (client_closing_month % 12) + 1
where client_fiscal_start_month is null;

update daily_reports
set fiscal_year = case
  when extract(month from work_date) <= client_closing_month
    then extract(year from work_date)::integer - 1
  else extract(year from work_date)::integer
end
where fiscal_year is null;

update daily_reports
set fiscal_year_label = fiscal_year || '年度'
where fiscal_year_label is null;

update daily_reports
set current_total_journal_count = total_sorting_count
where current_total_journal_count is null;

with ordered as (
  select id, lag(total_sorting_count) over (partition by client_id, fiscal_year order by work_date, created_at) as prev_total
  from daily_reports
)
update daily_reports d
set previous_total_journal_count = coalesce(ordered.prev_total, 0)
from ordered
where d.id = ordered.id and d.previous_total_journal_count is null;

create table if not exists worker_outsource_prices (
  worker_id text primary key references workers(id) on delete cascade,
  manual_unit_price integer not null default 40 check (manual_unit_price >= 0),
  smart_unit_price integer not null default 20 check (smart_unit_price >= 0),
  submitted_documents_unit_price integer not null default 1000 check (submitted_documents_unit_price >= 0),
  office_work_unit_price integer not null default 300 check (office_work_unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 仕訳作業以外の月次作業（提出書類・その他事務業務・給与計算など）について、
-- 担当者×作業種別ごとの個別外注単価を設定するテーブル。未設定の場合はwork_typesマスタの外注単価を使う。
create table if not exists worker_work_type_outsource_prices (
  id text primary key,
  worker_id text not null references workers(id) on delete cascade,
  work_type_id text not null references work_types(id) on delete cascade,
  outsource_unit_price integer not null default 0 check (outsource_unit_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists worker_work_type_outsource_prices_unique_idx
  on worker_work_type_outsource_prices(worker_id, work_type_id);
create index if not exists worker_work_type_outsource_prices_worker_idx
  on worker_work_type_outsource_prices(worker_id);

create table if not exists monthly_work_reports (
  id text primary key,
  work_date date not null,
  work_month text not null,
  worker_id text references workers(id) on delete restrict,
  work_type_id text not null references work_types(id) on delete restrict,
  client_id text not null references clients(id) on delete restrict,
  document_count integer not null default 0 check (document_count >= 0),
  work_minutes integer not null default 0 check (work_minutes >= 0),
  memo text not null default '',
  source text not null default 'admin' check (source in ('admin', 'worker_link')),
  source_worker_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_work_reports_quantity_check check (document_count >= 0 and work_minutes >= 0)
);

alter table monthly_work_reports add column if not exists worker_id text references workers(id) on delete restrict;
alter table monthly_work_reports drop constraint if exists monthly_work_reports_quantity_check;
alter table daily_reports add column if not exists source text not null default 'admin' check (source in ('admin', 'worker_link'));
alter table daily_reports add column if not exists source_worker_id text not null default '';
alter table monthly_work_reports add column if not exists source text not null default 'admin' check (source in ('admin', 'worker_link'));
alter table monthly_work_reports add column if not exists source_worker_id text not null default '';

create table if not exists worker_share_links (
  worker_id text primary key references workers(id) on delete cascade,
  token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_statement_settings (
  id text primary key default 'default',
  title text not null default '支払明細書',
  issuer_name text not null default '',
  issuer_address text not null default '',
  issuer_phone text not null default '',
  issuer_email text not null default '',
  registration_number text not null default '',
  payment_due_text text not null default '翌月末払い',
  bank_fee_text text not null default '振込手数料は受取人負担とします。',
  notes text not null default '',
  footer_text text not null default 'ご確認ありがとうございます。',
  updated_at timestamptz not null default now()
);

create table if not exists backup_records (
  id text primary key,
  backup_datetime timestamptz not null,
  backup_type text not null check (backup_type in ('full_json', 'work_logs', 'settings')),
  target_month text not null,
  created_by text not null default 'admin',
  file_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists monthly_closings (
  id text primary key,
  target_month text not null unique,
  is_closed boolean not null default false,
  closed_at timestamptz,
  closed_by text not null default '',
  closing_backup_id text references backup_records(id) on delete set null,
  sales_total integer not null default 0 check (sales_total >= 0),
  outsource_total integer not null default 0 check (outsource_total >= 0),
  gross_profit integer not null default 0,
  report_count integer not null default 0 check (report_count >= 0),
  note text not null default '',
  reopened_at timestamptz,
  reopened_by text not null default '',
  reopen_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  action_type text not null,
  target_type text not null,
  target_id text not null default '',
  target_month text not null default '',
  message text not null default '',
  before_data jsonb,
  after_data jsonb,
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);

alter table monthly_closings add column if not exists is_closed boolean not null default false;
alter table monthly_closings add column if not exists reopened_at timestamptz;
alter table monthly_closings add column if not exists reopened_by text not null default '';
alter table monthly_closings add column if not exists reopen_reason text not null default '';
alter table monthly_closings add column if not exists updated_at timestamptz not null default now();

create index if not exists daily_reports_work_month_idx on daily_reports(work_month);
create index if not exists daily_reports_client_date_idx on daily_reports(client_id, work_date);
create index if not exists daily_reports_worker_month_idx on daily_reports(worker_id, work_month);
create index if not exists monthly_work_reports_work_month_idx on monthly_work_reports(work_month);
create index if not exists monthly_work_reports_client_month_idx on monthly_work_reports(client_id, work_month);
create index if not exists monthly_work_reports_type_month_idx on monthly_work_reports(work_type_id, work_month);
create index if not exists worker_share_links_token_idx on worker_share_links(token);
create index if not exists backup_records_target_month_idx on backup_records(target_month);
create index if not exists monthly_closings_target_month_idx on monthly_closings(target_month);
create index if not exists audit_logs_target_month_idx on audit_logs(target_month, created_at desc);

do $$
declare
  base_no integer;
begin
  select coalesce(max((substring(worker_code from 2))::integer), 0)
    into base_no
    from workers
    where worker_code ~ '^W[0-9]+$';

  with numbered as (
    select id, worker_code, created_at, row_number() over (partition by nullif(worker_code, '') order by created_at, id) as code_rank
    from workers
  ),
  targets as (
    select id, row_number() over (order by created_at, id) as seq
    from numbered
    where worker_code = '' or code_rank > 1
  )
  update workers
  set worker_code = 'W' || lpad((base_no + targets.seq)::text, 3, '0')
  from targets
  where workers.id = targets.id;
end $$;

do $$
declare
  base_no integer;
begin
  select coalesce(max((substring(code from 2))::integer), 0)
    into base_no
    from clients
    where code ~ '^C[0-9]+$';

  with numbered as (
    select id, code, created_at, row_number() over (partition by nullif(code, '') order by created_at, id) as code_rank
    from clients
  ),
  targets as (
    select id, row_number() over (order by created_at, id) as seq
    from numbered
    where code = '' or code_rank > 1
  )
  update clients
  set code = 'C' || lpad((base_no + targets.seq)::text, 3, '0')
  from targets
  where clients.id = targets.id;
end $$;

do $$
declare
  base_no integer;
begin
  select coalesce(max((substring(work_type_code from 2))::integer), 0)
    into base_no
    from work_types
    where work_type_code ~ '^T[0-9]+$';

  with numbered as (
    select id, work_type_code, created_at, row_number() over (partition by nullif(work_type_code, '') order by created_at, id) as code_rank
    from work_types
  ),
  targets as (
    select id, row_number() over (order by created_at, id) as seq
    from numbered
    where work_type_code = '' or code_rank > 1
  )
  update work_types
  set work_type_code = 'T' || lpad((base_no + targets.seq)::text, 3, '0')
  from targets
  where work_types.id = targets.id;
end $$;

create unique index if not exists workers_worker_code_unique_idx on workers(worker_code);
create unique index if not exists clients_code_unique_idx on clients(code);
create unique index if not exists work_types_work_type_code_unique_idx on work_types(work_type_code);

alter table workers enable row level security;
alter table clients enable row level security;
alter table daily_reports enable row level security;
alter table work_types enable row level security;
alter table unit_prices enable row level security;
alter table sorting_unit_prices enable row level security;
alter table worker_outsource_prices enable row level security;
alter table worker_work_type_outsource_prices enable row level security;
alter table worker_share_links enable row level security;
alter table monthly_work_reports enable row level security;
alter table payment_statement_settings enable row level security;
alter table backup_records enable row level security;
alter table monthly_closings enable row level security;
alter table audit_logs enable row level security;

drop policy if exists "workers_select" on workers;
drop policy if exists "workers_insert" on workers;
drop policy if exists "workers_update" on workers;
drop policy if exists "workers_delete" on workers;

drop policy if exists "clients_select" on clients;
drop policy if exists "clients_insert" on clients;
drop policy if exists "clients_update" on clients;
drop policy if exists "clients_delete" on clients;

drop policy if exists "daily_reports_select" on daily_reports;
drop policy if exists "daily_reports_insert" on daily_reports;
drop policy if exists "daily_reports_update" on daily_reports;
drop policy if exists "daily_reports_delete" on daily_reports;

drop policy if exists "work_types_select" on work_types;
drop policy if exists "work_types_insert" on work_types;
drop policy if exists "work_types_update" on work_types;
drop policy if exists "work_types_delete" on work_types;

drop policy if exists "unit_prices_select" on unit_prices;
drop policy if exists "unit_prices_insert" on unit_prices;
drop policy if exists "unit_prices_update" on unit_prices;
drop policy if exists "unit_prices_delete" on unit_prices;

drop policy if exists "sorting_unit_prices_select" on sorting_unit_prices;
drop policy if exists "sorting_unit_prices_insert" on sorting_unit_prices;
drop policy if exists "sorting_unit_prices_update" on sorting_unit_prices;
drop policy if exists "sorting_unit_prices_delete" on sorting_unit_prices;

drop policy if exists "worker_outsource_prices_select" on worker_outsource_prices;
drop policy if exists "worker_outsource_prices_insert" on worker_outsource_prices;
drop policy if exists "worker_outsource_prices_update" on worker_outsource_prices;
drop policy if exists "worker_outsource_prices_delete" on worker_outsource_prices;

drop policy if exists "worker_work_type_outsource_prices_select" on worker_work_type_outsource_prices;
drop policy if exists "worker_work_type_outsource_prices_insert" on worker_work_type_outsource_prices;
drop policy if exists "worker_work_type_outsource_prices_update" on worker_work_type_outsource_prices;
drop policy if exists "worker_work_type_outsource_prices_delete" on worker_work_type_outsource_prices;

drop policy if exists "worker_share_links_select" on worker_share_links;
drop policy if exists "worker_share_links_insert" on worker_share_links;
drop policy if exists "worker_share_links_update" on worker_share_links;
drop policy if exists "worker_share_links_delete" on worker_share_links;

drop policy if exists "monthly_work_reports_select" on monthly_work_reports;
drop policy if exists "monthly_work_reports_insert" on monthly_work_reports;
drop policy if exists "monthly_work_reports_update" on monthly_work_reports;
drop policy if exists "monthly_work_reports_delete" on monthly_work_reports;

drop policy if exists "payment_statement_settings_select" on payment_statement_settings;
drop policy if exists "payment_statement_settings_insert" on payment_statement_settings;
drop policy if exists "payment_statement_settings_update" on payment_statement_settings;
drop policy if exists "payment_statement_settings_delete" on payment_statement_settings;

drop policy if exists "backup_records_select" on backup_records;
drop policy if exists "backup_records_insert" on backup_records;
drop policy if exists "backup_records_update" on backup_records;
drop policy if exists "backup_records_delete" on backup_records;

drop policy if exists "monthly_closings_select" on monthly_closings;
drop policy if exists "monthly_closings_insert" on monthly_closings;
drop policy if exists "monthly_closings_update" on monthly_closings;
drop policy if exists "monthly_closings_delete" on monthly_closings;

drop policy if exists "audit_logs_select" on audit_logs;
drop policy if exists "audit_logs_insert" on audit_logs;
drop policy if exists "audit_logs_update" on audit_logs;
drop policy if exists "audit_logs_delete" on audit_logs;

-- Production safety:
-- This schema creates tables, columns, indexes, and policies only.
-- It intentionally does not insert sample workers, clients, prices, share links,
-- or payment settings. Create sample data from the app only when explicitly needed.

-- 01: 追加のみ（切替前に実行可。現行アプリはこのまま動く）
-- データの削除・初期化なし。再実行しても安全。

-- 共有リンク: トークンはハッシュで保存し、平文は保持しない。初回利用日時で受領を確認する。
alter table worker_share_links add column if not exists token_hash text;
alter table worker_share_links add column if not exists issued_at timestamptz;
alter table worker_share_links add column if not exists first_used_at timestamptz;
alter table worker_share_links alter column token drop not null;
create unique index if not exists worker_share_links_token_hash_key on worker_share_links(token_hash) where token_hash is not null;

-- 確定月の保護をDBで強制する（作業日で判定、変更前・変更後の両方の月）。
-- 月ごとのアドバイザリーロックで、月次確定と日報書込みを直列化し、確認と書込みの間の競合を防ぐ。
create or replace function enforce_open_work_month() returns trigger
language plpgsql
set search_path = public
as $$
declare
  months text[] := '{}';
  target text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    months := months || to_char(old.work_date, 'YYYY-MM');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    months := months || to_char(new.work_date, 'YYYY-MM');
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into months from unnest(months) as m;
  foreach target in array months loop
    perform pg_advisory_xact_lock(hashtext('work_month:' || target));
    if exists (select 1 from monthly_closings where target_month = target and is_closed) then
      raise exception 'この月は月次確定済みのため、作業の追加・編集・削除はできません。修正が必要な場合は、月次確定を解除してください。'
        using errcode = 'P0001';
    end if;
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function lock_closing_month() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('work_month:' || new.target_month));
  return new;
end;
$$;

drop trigger if exists daily_reports_enforce_open_month on daily_reports;
create trigger daily_reports_enforce_open_month
  before insert or update or delete on daily_reports
  for each row execute function enforce_open_work_month();

drop trigger if exists monthly_work_reports_enforce_open_month on monthly_work_reports;
create trigger monthly_work_reports_enforce_open_month
  before insert or update or delete on monthly_work_reports
  for each row execute function enforce_open_work_month();

drop trigger if exists monthly_closings_lock_month on monthly_closings;
create trigger monthly_closings_lock_month
  before insert or update on monthly_closings
  for each row execute function lock_closing_month();

-- 02: 公開アクセスの遮断（切替当日、新しいアプリのデプロイ後に実行）
-- 実行後、ブラウザの公開キー（anon）からはDBを読み書きできなくなる。
-- 旧アプリ（PR-3より前）はこの時点で動かなくなるため、必ず新アプリのデプロイ後に実行する。
-- データの削除・初期化なし。公開権限（anon全開放）へ戻すロールバックは行わない。

-- 1) 全行を許可するポリシー等、対象表のポリシーをすべて削除する。RLSは有効のまま残すので、
--    ポリシーがない状態では anon / authenticated は1行も読み書きできない。
do $$
declare
  policy record;
begin
  for policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'workers', 'clients', 'daily_reports', 'work_types', 'unit_prices', 'sorting_unit_prices',
        'worker_outsource_prices', 'worker_work_type_outsource_prices', 'worker_share_links',
        'monthly_work_reports', 'payment_statement_settings', 'backup_records', 'monthly_closings', 'audit_logs'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', policy.policyname, policy.schemaname, policy.tablename);
  end loop;
end $$;

alter table workers enable row level security;
alter table clients enable row level security;
alter table daily_reports enable row level security;
alter table work_types enable row level security;
alter table unit_prices enable row level security;
alter table sorting_unit_prices enable row level security;
alter table worker_outsource_prices enable row level security;
alter table worker_work_type_outsource_prices enable row level security;
alter table worker_share_links enable row level security;
alter table monthly_work_reports enable row level security;
alter table payment_statement_settings enable row level security;
alter table backup_records enable row level security;
alter table monthly_closings enable row level security;
alter table audit_logs enable row level security;

-- 2) 権限そのものを取り消す（TRUNCATE等を含む全権限）。関数・シーケンスも対象。
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- 3) 今後作るテーブル等にも自動で権限が付かないようにする（実行ユーザー postgres が作成するもの）。
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;
