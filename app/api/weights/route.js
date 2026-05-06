import { NextResponse } from "next/server";
import { deleteWeightRecord, listWeightRecords, updateWeightRecord } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const weightRecords = await listWeightRecords(petId);
  return NextResponse.json({ weightRecords });
}

export async function PATCH(request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await updateWeightRecord(body);
  return NextResponse.json(result);
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await deleteWeightRecord(id);
  return NextResponse.json({ result });
}
