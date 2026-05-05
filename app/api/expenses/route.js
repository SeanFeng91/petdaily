import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const expenses = await prisma.expense.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { purchasedAt: "desc" },
    take: 100
  });

  return NextResponse.json({ expenses });
}

export async function POST(request) {
  const body = await request.json();
  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const expense = await prisma.expense.create({
    data: {
      petId: body.petId,
      category: body.category || "DAILY",
      itemName: body.itemName?.trim() || "宠物用品",
      amountCents: Math.round(Number(body.amount || 0) * 100),
      purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : new Date(),
      note: body.note?.trim() || null
    }
  });

  return NextResponse.json({ expense });
}
