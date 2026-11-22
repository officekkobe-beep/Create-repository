// サーバーのインスタンス単位の簡易な回数制限（連打・誤操作の抑止用。厳密な分散制限ではない）。
const buckets = new Map<string, number[]>();

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 1000) {
    for (const [bucketKey, times] of buckets) {
      if (!times.some((time) => now - time < windowMs)) buckets.delete(bucketKey);
    }
  }
  return true;
}
