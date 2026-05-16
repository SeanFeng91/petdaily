import { NextResponse } from "next/server";
import { createTimelineEvent, deleteTimelineEvent, listTimelineEvents, updateTimelineEvent } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");

  const timelineEvents = await listTimelineEvents(petId);
  return NextResponse.json({ timelineEvents });
}

export async function POST(request) {
  const body = await request.json();

  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const result = await createTimelineEvent(body);
  return NextResponse.json(result);
}

export async function PATCH(request) {
  const body = await request.json();
  const id = body.id;

  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await updateTimelineEvent(id, body);
  if (!result.event) {
    return NextResponse.json({ message: "event not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await deleteTimelineEvent(id);
  return NextResponse.json({ result });
}
