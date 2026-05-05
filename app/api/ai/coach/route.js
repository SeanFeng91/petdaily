import { NextResponse } from "next/server";
import { generateCoachInsight } from "@/lib/ai-coach";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json();

  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const insight = await generateCoachInsight(body.petId);
  return NextResponse.json({ insight });
}
