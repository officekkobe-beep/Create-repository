-- 読み取り専用の確認クエリ（データ行は表示しない）。01〜03の実行前後に実行して結果を比較する。

-- A. 公開ロールに残っている表の権限（切替後は 0 行であること）
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- B. publicスキーマのポリシー（切替後は 0 行であること）
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- C. RLSが無効の表（0 行であること）
select c.relname as table_name
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- D. 公開ロールから実行できる関数（切替後は 0 行であること）
select p.proname, r.rolname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'execute');

-- E. view（anonがアクセスできる迂回経路がないこと。0 行が想定）
select table_name from information_schema.views where table_schema = 'public';

-- F. 確定月保護トリガー（3 行あること）
select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public' and trigger_name in ('daily_reports_enforce_open_month', 'monthly_work_reports_enforce_open_month', 'monthly_closings_lock_month')
group by event_object_table, trigger_name;

-- G. 共有リンクの状態（件数のみ。切替後、平文トークン残存は 0 件であること）
select
  count(*) as total_links,
  count(*) filter (where active) as active_links,
  count(*) filter (where token is not null) as plaintext_tokens,
  count(*) filter (where token_hash is not null) as hashed_tokens,
  count(*) filter (where first_used_at is not null) as used_links
from worker_share_links;
