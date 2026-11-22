import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) return NextResponse.json({ authenticated: false, error: session.error }, { status: session.status });
  return NextResponse.json({ authenticated: true, email: session.email });
}
