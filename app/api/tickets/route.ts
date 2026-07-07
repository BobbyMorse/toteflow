import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tickets: Tickets.list() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const t: Ticket = {
    id: `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    raceId: body.raceId,
    type: body.type,
    selections: body.selections,
    stake: Number(body.stake) || 0,
    potentialPayout: Number(body.potentialPayout) || 0,
    capturedEV: Number(body.capturedEV) || 0,
    capturedOdds: Number(body.capturedOdds) || 0,
    placedAt: Date.now(),
    status: "open",
    mode: "manual",
  };
  Tickets.add(t);
  return NextResponse.json({ ticket: t });
}
