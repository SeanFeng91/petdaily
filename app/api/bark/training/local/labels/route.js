import { NextResponse } from "next/server";
import { createLocalBarkLabelOption, deleteLocalBarkLabelOption, listLocalBarkLabelOptions } from "@/lib/bark-training-local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ labels: listLocalBarkLabelOptions() });
  } catch (error) {
    console.error("Failed to list local bark labels", error);
    return NextResponse.json({ message: "本地标签读取失败。" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json({ labels: createLocalBarkLabelOption(body || {}) });
  } catch (error) {
    console.error("Failed to create local bark label", error);
    return NextResponse.json({ message: error?.message || "本地标签创建失败。" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    return NextResponse.json({ labels: deleteLocalBarkLabelOption(body || {}) });
  } catch (error) {
    console.error("Failed to delete local bark label", error);
    return NextResponse.json({ message: error?.message || "本地标签删除失败。" }, { status: 500 });
  }
}
