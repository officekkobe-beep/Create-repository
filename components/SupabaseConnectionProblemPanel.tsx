export function SupabaseConnectionProblemPanel({ detail }: { detail?: string }) {
  return (
    <section className="panel space-y-3 border border-red-200 bg-red-50 p-5 text-sm text-red-900">
      <h2 className="text-lg font-bold text-red-800">Supabaseに接続できません</h2>
      <p>
        画面上のデータが空や古い状態に見えても、Supabase上のデータが削除されたとは限りません。データ保護のため、Supabaseへの接続が回復するまで作業入力・編集・削除画面は表示しません。
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <span className="font-bold">Supabase一時停止の可能性:</span> 無料プランは一定期間アクセスがないと自動的に一時停止されることがあります。まずSupabaseダッシュボードでプロジェクトの状態を確認してください。
        </li>
        <li>
          <span className="font-bold">Resume project:</span> プロジェクトが一時停止している場合は、Supabaseダッシュボードの「Resume project」を押して再開してください。
        </li>
        <li>
          <span className="font-bold">Vercel環境変数確認:</span> VercelのProduction環境で <code>NEXT_PUBLIC_SUPABASE_URL</code> と <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> が正しく設定されているか確認してください。
        </li>
      </ol>
      <p>復旧後にこのページを再読み込みすると、Supabase上のデータが表示されます。</p>
      {detail ? <p className="text-xs text-red-700">詳細: {detail}</p> : null}
    </section>
  );
}
