import { NextResponse } from "next/server";
import { createPhoto, deletePhoto, listPhotos } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const photos = await listPhotos(petId);
  return NextResponse.json({ photos });
}

export async function POST(request) {
  const body = await request.json();
  if (!body.petId || !body.url) {
    return NextResponse.json({ message: "petId and url are required" }, { status: 400 });
  }

  const photo = await createPhoto(body);
  return NextResponse.json({ photo });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await deletePhoto(id);
  return NextResponse.json({ result });
}
