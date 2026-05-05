import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const insights = await prisma.aiInsight.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { generatedAt: "desc" },
    take: 20
  });

  return NextResponse.json({ insights });
}
