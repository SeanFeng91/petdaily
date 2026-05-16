import { NextResponse } from "next/server";
import { createBarkLabelOption, deleteBarkLabelOption, listBarkLabelOptions } from "@/lib/pet-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const petId = searchParams.get("petId");
    return NextResponse.json({ labels: await listBarkLabelOptions(petId) });
  } catch (error) {
    console.error("Failed to list bark labels", error);
    return NextResponse.json({ message: "标注标签读取失败。" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json({ labels: await createBarkLabelOption(body || {}) });
  } catch (error) {
    console.error("Failed to create bark label", error);
    return NextResponse.json({ message: error?.message || "标注标签创建失败。" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    return NextResponse.json({ labels: await deleteBarkLabelOption(body || {}) });
  } catch (error) {
    console.error("Failed to delete bark label", error);
    return NextResponse.json({ message: error?.message || "标注标签删除失败。" }, { status: 500 });
  }
}
