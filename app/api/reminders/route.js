import { NextResponse } from "next/server";
import { createReminder, deleteReminder, listReminders, updateReminder } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const reminders = await listReminders(petId);
  return NextResponse.json({ reminders });
}

export async function POST(request) {
  const body = await request.json();
  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const reminder = await createReminder(body);
  return NextResponse.json({ reminder });
}

export async function PATCH(request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const reminder = await updateReminder(body);
  return NextResponse.json({ reminder });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await deleteReminder(id);
  return NextResponse.json({ result });
}
