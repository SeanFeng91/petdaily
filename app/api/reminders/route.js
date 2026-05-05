import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const reminders = await prisma.reminder.findMany({
    where: petId ? { petId } : undefined,
    orderBy: [{ active: "desc" }, { scheduledTime: "asc" }]
  });

  return NextResponse.json({ reminders });
}

export async function POST(request) {
  const body = await request.json();
  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const reminder = await prisma.reminder.create({
    data: {
      petId: body.petId,
      kind: body.kind || "FOOD",
      title: body.title?.trim() || "新提醒",
      scheduledTime: body.scheduledTime || "08:00",
      weekdays: body.weekdays || "1,2,3,4,5,6,7",
      nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : null,
      note: body.note?.trim() || null
    }
  });

  return NextResponse.json({ reminder });
}

export async function PATCH(request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const reminder = await prisma.reminder.update({
    where: { id: body.id },
    data: {
      active: typeof body.active === "boolean" ? body.active : undefined,
      title: body.title?.trim() || undefined,
      scheduledTime: body.scheduledTime || undefined,
      note: body.note?.trim() || undefined
    }
  });

  return NextResponse.json({ reminder });
}
