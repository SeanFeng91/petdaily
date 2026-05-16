import { NextResponse } from "next/server";
import { getLocalTrainingState, runLocalTrainingAction, updateLocalTrainingLabel } from "@/lib/bark-training-local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getErrorMessage(error, fallback) {
  const message = error?.message || fallback;
  if (message.includes("nvm use")) return message;
  if (message.includes("wrangler")) return message;
  return message || fallback;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const petId = searchParams.get("petId");
    return NextResponse.json(getLocalTrainingState(petId));
  } catch (error) {
    console.error("Failed to read local bark training state", error);
    return NextResponse.json({ message: getErrorMessage(error, "本地训练数据读取失败。") }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body?.action;
    if (!["download", "train", "push", "sync"].includes(action)) {
      return NextResponse.json({ message: "action is required" }, { status: 400 });
    }
    return NextResponse.json(runLocalTrainingAction(action, body?.petId || null));
  } catch (error) {
    console.error("Failed to run local bark training action", error);
    return NextResponse.json({ message: getErrorMessage(error, "本地训练动作执行失败。") }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!body?.sampleId || !body?.reason) {
      return NextResponse.json({ message: "sampleId and reason are required" }, { status: 400 });
    }
    return NextResponse.json(
      updateLocalTrainingLabel({
        petId: body?.petId || null,
        sampleId: body.sampleId,
        reason: body.reason,
        applyToCluster: body.applyToCluster !== false
      })
    );
  } catch (error) {
    console.error("Failed to update local bark labels", error);
    return NextResponse.json({ message: getErrorMessage(error, "本地标注保存失败。") }, { status: 500 });
  }
}
