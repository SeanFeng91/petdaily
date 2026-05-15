import { NextResponse } from "next/server";
import { rebuildBarkClusters } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

function getClusterErrorMessage(error) {
  const message = error?.message || "";
  if (message.includes("BarkCluster") || message.includes("BarkSample")) {
    return "声音库数据库结构未更新，请先应用 BarkSample/BarkCluster 迁移。";
  }
  if (message.includes("BarkSession") || message.includes("sessionId")) {
    return "声音库数据库结构未更新，请先应用 BarkSession 迁移。";
  }
  if (message.includes("foreign key") || message.includes("FOREIGN KEY")) {
    return "聚类索引存在旧关联，已阻止重算。请刷新声音库后再试，若仍失败请重新应用声音库迁移。";
  }
  return message || "重新聚类失败。";
}

export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.petId) {
      return NextResponse.json({ message: "petId is required" }, { status: 400 });
    }

    const result = await rebuildBarkClusters(body.petId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to rebuild bark clusters", error);
    return NextResponse.json({ message: getClusterErrorMessage(error) }, { status: 500 });
  }
}
