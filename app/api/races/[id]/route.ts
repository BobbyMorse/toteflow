import { NextResponse } from "next/server";
import { liveProviders } from "@/lib/adapters";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  for (const p of liveProviders()) {
    const r = await p.getRace(id);
    if (r) return NextResponse.json({ race: r, ts: Date.now() });
  }
  return NextResponse.json({ race: null }, { status: 404 });
}
