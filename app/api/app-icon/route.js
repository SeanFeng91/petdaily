import { NextResponse } from "next/server";
import { listPets } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

const FALLBACK_ICON_PATH = "/icons/petdaily-icon-512.png";

function responseWithCache(body, contentType) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType || "image/png",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}

function dataUrlToResponse(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;

  const contentType = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const data = match[3] || "";
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return responseWithCache(bytes, contentType);
}

async function fetchIcon(source, requestUrl) {
  const url = new URL(source || FALLBACK_ICON_PATH, requestUrl);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "image/png";
  const body = await response.arrayBuffer();
  return responseWithCache(body, contentType);
}

export async function GET(request) {
  try {
    const pets = await listPets();
    const source = pets[0]?.avatarUrl || FALLBACK_ICON_PATH;

    if (source.startsWith("data:")) {
      const dataResponse = dataUrlToResponse(source);
      if (dataResponse) return dataResponse;
    }

    const fetched = await fetchIcon(source, request.url);
    if (fetched) return fetched;
  } catch {
    // Fall through to the static fallback below.
  }

  const fallback = await fetchIcon(FALLBACK_ICON_PATH, request.url);
  if (fallback) return fallback;
  return NextResponse.json({ message: "icon unavailable" }, { status: 404 });
}
