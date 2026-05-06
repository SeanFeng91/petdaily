import { NextResponse } from "next/server";
import { listPets, savePetProfile } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const pets = await listPets();
  return NextResponse.json({ pets });
}

export async function POST(request) {
  const body = await request.json();
  const pet = await savePetProfile(body);
  return NextResponse.json({ pet });
}
