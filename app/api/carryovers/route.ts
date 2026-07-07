import { NextResponse } from "next/server";
import { detectCarryovers } from "@/lib/carryovers";

export const dynamic = "force-dynamic";

export async function GET() {
  const opportunities = await detectCarryovers();
  return NextResponse.json({
    opportunities,
    ts: Date.now(),
    note: "Pool sizes are real (from upstream tote feed). Carryover dollars are estimated by subtracting a typical-day baseline. Only wagers actually offered on the listed ADW appear here.",
  });
}
