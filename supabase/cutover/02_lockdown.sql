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
revoke all on all tables in schema public from PUBLIC, anon, authenticated;
revoke all on all sequences in schema public from PUBLIC, anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- 3) 今後作るテーブル等にも自動で権限が付かないようにする（実行ユーザー postgres が作成するもの）。
alter default privileges for role postgres in schema public revoke all on tables from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;
