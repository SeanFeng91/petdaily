import { NextResponse } from "next/server";
import { updateBarkSample } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  const result = await updateBarkSample(id, body);

  if (!result.sample) {
    return NextResponse.json({ message: "sample not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
