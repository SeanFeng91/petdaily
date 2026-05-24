import { getBarkAudio } from "@/lib/pet-store";

export const dynamic = "force-dynamic";

function inferAudioContentType(contentType, sample, fallback = "audio/webm") {
  const raw = String(contentType || "").trim().toLowerCase();
  if (raw.startsWith("audio/")) return raw;
  if (raw === "video/webm") return "audio/webm";

  const hints = [
    raw,
    sample?.audioContentType,
    sample?.audioObjectKey,
    sample?.audioUrl
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  if (hints.some((value) => value.includes(".m4a") || value.includes("audio/mp4") || value.includes("mp4a"))) {
    return "audio/mp4";
  }
  if (hints.some((value) => value.includes(".mp3") || value.includes("mpeg"))) {
    return "audio/mpeg";
  }
  if (hints.some((value) => value.includes(".wav") || value.includes("audio/wav") || value.includes("x-wav"))) {
    return "audio/wav";
  }
  if (hints.some((value) => value.includes(".ogg") || value.includes("ogg") || value.includes("opus"))) {
    return "audio/ogg";
  }
  if (hints.some((value) => value.includes(".webm") || value.includes("webm"))) {
    return "audio/webm";
  }
  return fallback;
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !Number.isFinite(size) || size <= 0) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] === "" ? Math.max(0, size - Number(match[2] || 0)) : Number(match[1]);
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return {
    start,
    end: Math.min(end, size - 1)
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges"
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function buildAudioResponse(request, params, { headOnly = false } = {}) {
  const { id } = await params;
  const audio = await getBarkAudio(id);

  if (!audio) {
    return new Response("音频片段不存在或 R2 对象未找到。", { status: 404, headers: corsHeaders() });
  }

  const size = audio.size || audio.body?.byteLength || 0;
  if (!size) {
    return new Response("音频片段为空，可能采集时没有录到可保存音频。", { status: 422, headers: corsHeaders() });
  }

  const contentType = inferAudioContentType(audio.contentType, audio.sample);
  const range = parseRangeHeader(request.headers.get("range"), size);
  const headers = {
    ...corsHeaders(),
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline"
  };

  if (range) {
    const body = headOnly ? null : audio.body.slice(range.start, range.end + 1);
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`
      }
    });
  }

  return new Response(headOnly ? null : audio.body, {
    headers: {
      ...headers,
      "Content-Length": String(size)
    }
  });
}

export async function HEAD(request, context) {
  try {
    return await buildAudioResponse(request, context.params, { headOnly: true });
  } catch (error) {
    console.error("Failed to probe bark audio", error);
    return new Response(null, { status: 500, headers: corsHeaders() });
  }
}

export async function GET(request, context) {
  try {
    return await buildAudioResponse(request, context.params);
  } catch (error) {
    console.error("Failed to read bark audio", error);
    return new Response("音频读取失败，请稍后再试。", { status: 500, headers: corsHeaders() });
  }
}
