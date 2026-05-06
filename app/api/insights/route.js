import { NextResponse } from "next/server";
import { listInsights } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const insights = await listInsights(petId);
  return NextResponse.json({ insights });
}
