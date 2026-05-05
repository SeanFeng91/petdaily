import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const photos = await prisma.photoAsset.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { takenAt: "desc" },
    take: 80
  });

  return NextResponse.json({ photos });
}

export async function POST(request) {
  const body = await request.json();
  if (!body.petId || !body.url) {
    return NextResponse.json({ message: "petId and url are required" }, { status: 400 });
  }

  const photo = await prisma.photoAsset.create({
    data: {
      petId: body.petId,
      url: body.url.trim(),
      caption: body.caption?.trim() || "成长照片",
      takenAt: body.takenAt ? new Date(body.takenAt) : new Date()
    }
  });

  await prisma.timelineEvent.create({
    data: {
      petId: body.petId,
      type: "PHOTO",
      title: photo.caption || "成长照片",
      happenedAt: photo.takenAt,
      photoUrl: photo.url,
      metadata: JSON.stringify({ photoId: photo.id })
    }
  });

  return NextResponse.json({ photo });
}
