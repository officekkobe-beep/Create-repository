import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// サーバー専用。SUPABASE_SERVICE_ROLE_KEY はブラウザに渡さない（NEXT_PUBLIC_ を付けない）。
export function createServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
