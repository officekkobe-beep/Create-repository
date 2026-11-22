import { fetchData, setServerSupabaseClient } from "../storage";
import type { AppData } from "../types";
import { createServiceClient } from "./supabase-service";

// 管理者API専用。サービスキーのクライアントでDBの最新状態を読み込む（ブラウザの保持データは信用しない）。
export async function loadAdminData() {
  const supabase = createServiceClient();
  if (!supabase) return { ok: false as const, status: 503, error: "サーバーの設定が完了していません。" };
  setServerSupabaseClient(supabase);
  const result = await fetchData();
  if (result.mode !== "supabase") return { ok: false as const, status: 503, error: result.error ?? "データの読み込みに失敗しました。" };
  return { ok: true as const, data: result.data };
}

// 画面へ返すデータには共有リンクのトークン（旧方式の平文を含む）を載せない。
export function forClient(data: AppData): AppData {
  return { ...data, workerShareLinks: data.workerShareLinks.map((link) => ({ ...link, token: "" })) };
}
