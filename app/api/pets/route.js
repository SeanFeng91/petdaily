import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const pets = await prisma.petProfile.findMany({
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({ pets });
}

export async function POST(request) {
  const body = await request.json();
  const data = {
    name: body.name?.trim() || "小西高地",
    breed: body.breed?.trim() || "西高地白梗",
    sex: body.sex?.trim() || "female",
    birthday: body.birthday ? new Date(body.birthday) : new Date("2026-02-05"),
    avatarUrl: body.avatarUrl?.trim() || null,
    currentWeight: body.currentWeight ? Number(body.currentWeight) : null,
    notes: body.notes?.trim() || null
  };

  const pet = body.id
    ? await prisma.petProfile.update({
        where: { id: body.id },
        data
      })
    : await prisma.petProfile.create({ data });

  return NextResponse.json({ pet });
}
