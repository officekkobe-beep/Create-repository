-- 03: 旧共有リンク（平文トークン）の失効（切替当日、02の後に実行）
-- 新方式（token_hash）で発行していないリンクをすべて無効化し、平文トークンを消去する。
-- 消去したトークンは復元できない（旧リンクは二度と使えない）。担当者・日報データには影響しない。
update worker_share_links
set active = false,
    token = null,
    updated_at = now()
where token_hash is null;

-- 新方式で発行済みのリンクにも平文が残っていないことを保証する。
update worker_share_links
set token = null
where token_hash is not null and token is not null;
