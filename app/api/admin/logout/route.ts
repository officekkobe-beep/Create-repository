import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/server/admin-guard";
import { createAdminAuthClient } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "不正なリクエストです。" }, { status: 403 });
  const supabase = await createAdminAuthClient();
  if (supabase) await supabase.auth.signOut({ scope: "global" });
  return NextResponse.json({ ok: true });
}
