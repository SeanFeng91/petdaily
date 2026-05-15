import { NextResponse } from "next/server";
import { createBarkSample, listBarkSamples } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getErrorMessage(error, fallback) {
  const message = error?.message || fallback;
  if (message.includes("BarkSession") || message.includes("sessionId")) {
    return "声音库数据库结构未更新，请先应用 BarkSession 迁移。";
  }
  return message;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const petId = searchParams.get("petId");

    if (!petId) {
      return NextResponse.json({ message: "petId is required" }, { status: 400 });
    }

    const result = await listBarkSamples({
      petId,
      status: searchParams.get("status"),
      clusterId: searchParams.get("clusterId"),
      date: searchParams.get("date")
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to list bark samples", error);
    return NextResponse.json({ message: getErrorMessage(error, "声音样本读取失败。") }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const petId = form.get("petId");

    if (!petId) {
      return NextResponse.json({ message: "petId is required" }, { status: 400 });
    }

    const audio = form.get("audio");
    const result = await createBarkSample(
      {
        petId,
        capturedAt: form.get("capturedAt"),
        sessionStartedAt: form.get("sessionStartedAt"),
        durationMs: form.get("durationMs"),
        barkCount: form.get("barkCount"),
        barkScore: form.get("barkScore"),
        detectorVersion: form.get("detectorVersion"),
        note: form.get("note"),
        features: parseJsonField(form.get("features"), {}),
        embedding: parseJsonField(form.get("embedding"), []),
        waveform: parseJsonField(form.get("waveform"), [])
      },
      audio instanceof Blob ? audio : null
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to create bark sample", error);
    return NextResponse.json({ message: getErrorMessage(error, "声音样本保存失败。") }, { status: 500 });
  }
}
