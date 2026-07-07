import { NextResponse } from "next/server";
import { listProviders } from "@/lib/adapters";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ providers: listProviders() });
}
