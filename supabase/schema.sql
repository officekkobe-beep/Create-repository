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
alter table work_types add column if not exists work_type_code text not null default '';
alter table work_types add column if not exists unit_type text not null default 'count' check (unit_type in ('count', 'time'));
alter table work_types add column if not exists is_active boolean not null default true;

create table if not exists worker_outsource_prices (
  worker_id text primary key references workers(id) on delete cascade,
  manual_unit_price integer not null default 40 check (manual_unit_price >= 0),
  smart_unit_price integer not null default 20 check (smart_unit_price >= 0),
  submitted_documents_unit_price integer not null default 1000 check (submitted_documents_unit_price >= 0),
  office_work_unit_price integer not null default 300 check (office_work_unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists daily_reports_work_month_idx on daily_reports(work_month);
create index if not exists daily_reports_client_date_idx on daily_reports(client_id, work_date);
create index if not exists daily_reports_worker_month_idx on daily_reports(worker_id, work_month);
create index if not exists monthly_work_reports_work_month_idx on monthly_work_reports(work_month);
create index if not exists monthly_work_reports_client_month_idx on monthly_work_reports(client_id, work_month);
create index if not exists monthly_work_reports_type_month_idx on monthly_work_reports(work_type_id, work_month);
create index if not exists worker_share_links_token_idx on worker_share_links(token);

alter table workers enable row level security;
alter table clients enable row level security;
alter table daily_reports enable row level security;
alter table work_types enable row level security;
alter table unit_prices enable row level security;
alter table sorting_unit_prices enable row level security;
alter table worker_outsource_prices enable row level security;
alter table worker_share_links enable row level security;
alter table monthly_work_reports enable row level security;
alter table payment_statement_settings enable row level security;

drop policy if exists "workers_select" on workers;
drop policy if exists "workers_insert" on workers;
drop policy if exists "workers_update" on workers;
drop policy if exists "workers_delete" on workers;
create policy "workers_select" on workers for select using (true);
create policy "workers_insert" on workers for insert with check (true);
create policy "workers_update" on workers for update using (true) with check (true);
create policy "workers_delete" on workers for delete using (true);

drop policy if exists "clients_select" on clients;
drop policy if exists "clients_insert" on clients;
drop policy if exists "clients_update" on clients;
drop policy if exists "clients_delete" on clients;
create policy "clients_select" on clients for select using (true);
create policy "clients_insert" on clients for insert with check (true);
create policy "clients_update" on clients for update using (true) with check (true);
create policy "clients_delete" on clients for delete using (true);

drop policy if exists "daily_reports_select" on daily_reports;
drop policy if exists "daily_reports_insert" on daily_reports;
drop policy if exists "daily_reports_update" on daily_reports;
drop policy if exists "daily_reports_delete" on daily_reports;
create policy "daily_reports_select" on daily_reports for select using (true);
create policy "daily_reports_insert" on daily_reports for insert with check (true);
create policy "daily_reports_update" on daily_reports for update using (true) with check (true);
create policy "daily_reports_delete" on daily_reports for delete using (true);

drop policy if exists "work_types_select" on work_types;
drop policy if exists "work_types_insert" on work_types;
drop policy if exists "work_types_update" on work_types;
drop policy if exists "work_types_delete" on work_types;
create policy "work_types_select" on work_types for select using (true);
create policy "work_types_insert" on work_types for insert with check (true);
create policy "work_types_update" on work_types for update using (true) with check (true);
create policy "work_types_delete" on work_types for delete using (true);

drop policy if exists "unit_prices_select" on unit_prices;
drop policy if exists "unit_prices_insert" on unit_prices;
drop policy if exists "unit_prices_update" on unit_prices;
drop policy if exists "unit_prices_delete" on unit_prices;
create policy "unit_prices_select" on unit_prices for select using (true);
create policy "unit_prices_insert" on unit_prices for insert with check (true);
create policy "unit_prices_update" on unit_prices for update using (true) with check (true);
create policy "unit_prices_delete" on unit_prices for delete using (true);

drop policy if exists "sorting_unit_prices_select" on sorting_unit_prices;
drop policy if exists "sorting_unit_prices_insert" on sorting_unit_prices;
drop policy if exists "sorting_unit_prices_update" on sorting_unit_prices;
drop policy if exists "sorting_unit_prices_delete" on sorting_unit_prices;
create policy "sorting_unit_prices_select" on sorting_unit_prices for select using (true);
create policy "sorting_unit_prices_insert" on sorting_unit_prices for insert with check (true);
create policy "sorting_unit_prices_update" on sorting_unit_prices for update using (true) with check (true);
create policy "sorting_unit_prices_delete" on sorting_unit_prices for delete using (true);

drop policy if exists "worker_outsource_prices_select" on worker_outsource_prices;
drop policy if exists "worker_outsource_prices_insert" on worker_outsource_prices;
drop policy if exists "worker_outsource_prices_update" on worker_outsource_prices;
drop policy if exists "worker_outsource_prices_delete" on worker_outsource_prices;
create policy "worker_outsource_prices_select" on worker_outsource_prices for select using (true);
create policy "worker_outsource_prices_insert" on worker_outsource_prices for insert with check (true);
create policy "worker_outsource_prices_update" on worker_outsource_prices for update using (true) with check (true);
create policy "worker_outsource_prices_delete" on worker_outsource_prices for delete using (true);

drop policy if exists "worker_share_links_select" on worker_share_links;
drop policy if exists "worker_share_links_insert" on worker_share_links;
drop policy if exists "worker_share_links_update" on worker_share_links;
drop policy if exists "worker_share_links_delete" on worker_share_links;
create policy "worker_share_links_select" on worker_share_links for select using (true);
create policy "worker_share_links_insert" on worker_share_links for insert with check (true);
create policy "worker_share_links_update" on worker_share_links for update using (true) with check (true);
create policy "worker_share_links_delete" on worker_share_links for delete using (true);

drop policy if exists "monthly_work_reports_select" on monthly_work_reports;
drop policy if exists "monthly_work_reports_insert" on monthly_work_reports;
drop policy if exists "monthly_work_reports_update" on monthly_work_reports;
drop policy if exists "monthly_work_reports_delete" on monthly_work_reports;
create policy "monthly_work_reports_select" on monthly_work_reports for select using (true);
create policy "monthly_work_reports_insert" on monthly_work_reports for insert with check (true);
create policy "monthly_work_reports_update" on monthly_work_reports for update using (true) with check (true);
create policy "monthly_work_reports_delete" on monthly_work_reports for delete using (true);

drop policy if exists "payment_statement_settings_select" on payment_statement_settings;
drop policy if exists "payment_statement_settings_insert" on payment_statement_settings;
drop policy if exists "payment_statement_settings_update" on payment_statement_settings;
drop policy if exists "payment_statement_settings_delete" on payment_statement_settings;
create policy "payment_statement_settings_select" on payment_statement_settings for select using (true);
create policy "payment_statement_settings_insert" on payment_statement_settings for insert with check (true);
create policy "payment_statement_settings_update" on payment_statement_settings for update using (true) with check (true);
create policy "payment_statement_settings_delete" on payment_statement_settings for delete using (true);

-- Production safety:
-- This schema creates tables, columns, indexes, and policies only.
-- It intentionally does not insert sample workers, clients, prices, share links,
-- or payment settings. Create sample data from the app only when explicitly needed.
