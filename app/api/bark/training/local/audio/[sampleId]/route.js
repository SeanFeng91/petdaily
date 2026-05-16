import { getLocalTrainingAudio } from "@/lib/bark-training-local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { sampleId } = await params;
    const audio = getLocalTrainingAudio(sampleId);

    if (!audio) {
      return new Response("本地训练音频不存在。", { status: 404 });
    }

    return new Response(audio.body, {
      headers: {
        "Content-Type": audio.contentType,
        "Content-Length": String(audio.size),
        "Cache-Control": "private, max-age=60",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    console.error("Failed to read local bark training audio", error);
    return new Response("本地训练音频读取失败。", { status: 500 });
  }
}
