import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/server/admin-guard";
import { AdminCommandError, runAdminCommand } from "@/lib/server/admin-commands";
import { loadAdminData } from "@/lib/server/admin-data";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ command: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "不正なリクエストです。" }, { status: 403 });
  const session = await requireAdmin();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });

  const { command } = await params;
  const body = (await request.json().catch(() => null)) as { args?: unknown } | null;
  const loaded = await loadAdminData();
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });

  try {
    const data = await runAdminCommand(command, body?.args, loaded.data, { adminEmail: session.email });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (!(error instanceof AdminCommandError)) console.error(error);
    const message = error instanceof Error ? error.message : "処理に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
