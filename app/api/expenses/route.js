import { NextResponse } from "next/server";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const petId = searchParams.get("petId");
  const expenses = await listExpenses(petId);
  return NextResponse.json({ expenses });
}

export async function POST(request) {
  const body = await request.json();
  if (!body.petId) {
    return NextResponse.json({ message: "petId is required" }, { status: 400 });
  }

  const expense = await createExpense(body);
  return NextResponse.json({ expense });
}

export async function PATCH(request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const expense = await updateExpense(body);
  return NextResponse.json({ expense });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const result = await deleteExpense(id);
  return NextResponse.json({ result });
}
