import { NextResponse } from "next/server";
import { forClient, loadAdminData } from "@/lib/server/admin-data";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  const loaded = await loadAdminData();
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
  return NextResponse.json({ ok: true, data: forClient(loaded.data) });
}
