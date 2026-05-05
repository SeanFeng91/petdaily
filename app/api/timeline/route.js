import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");

  const timelineEvents = await prisma.timelineEvent.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { happenedAt: "desc" },
    take: 100
  });

  return NextResponse.json({ timelineEvents });
}

export async function POST(request) {
  const body = await request.json();

  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const happenedAt = body.happenedAt ? new Date(body.happenedAt) : new Date();
  const amount = body.amount === "" || body.amount == null ? null : Number(body.amount);
  const type = body.type || "NOTE";

  const event = await prisma.timelineEvent.create({
    data: {
      petId: body.petId,
      type,
      title: body.title?.trim() || "新记录",
      note: body.note?.trim() || null,
      happenedAt,
      amount,
      unit: body.unit?.trim() || null,
      metadata: JSON.stringify(body.metadata || {}),
      photoUrl: body.photoUrl?.trim() || null
    }
  });

  if (type === "WEIGHT" && amount) {
    await prisma.$transaction([
      prisma.weightRecord.create({
        data: {
          petId: body.petId,
          measuredAt: happenedAt,
          weightKg: amount,
          note: body.note?.trim() || null
        }
      }),
      prisma.petProfile.update({
        where: { id: body.petId },
        data: { currentWeight: amount }
      })
    ]);
  }

  if (type === "PHOTO" && body.photoUrl) {
    await prisma.photoAsset.create({
      data: {
        petId: body.petId,
        url: body.photoUrl.trim(),
        caption: body.title?.trim() || body.note?.trim() || "成长照片",
        takenAt: happenedAt,
        linkedEventId: event.id
      }
    });
  }

  return NextResponse.json({ event });
}
