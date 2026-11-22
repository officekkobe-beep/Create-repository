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
