import { getLocalCoachSummary } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts = data?.output?.flatMap((item) => item.content || []) || [];
  return parts.map((part) => part.text || "").filter(Boolean).join("\n").trim();
}

export async function generateCoachInsight(petId) {
  const [pet, timelineEvents, weightRecords, reminders, expenses] = await Promise.all([
    prisma.petProfile.findUnique({ where: { id: petId } }),
    prisma.timelineEvent.findMany({
      where: { petId },
      orderBy: { happenedAt: "desc" },
      take: 30
    }),
    prisma.weightRecord.findMany({
      where: { petId },
      orderBy: { measuredAt: "asc" },
      take: 20
    }),
    prisma.reminder.findMany({
      where: { petId },
      orderBy: { scheduledTime: "asc" }
    }),
    prisma.expense.findMany({
      where: { petId },
      orderBy: { purchasedAt: "desc" },
      take: 20
    })
  ]);

  if (!pet) {
    throw new Error("Pet not found");
  }

  const fallback = getLocalCoachSummary({ pet, timelineEvents, weightRecords, reminders });

  if (!process.env.OPENAI_API_KEY) {
    return persistInsight(petId, {
      ...fallback,
      scope: "daily",
      body: `${fallback.body}\n\n当前使用本地规则生成；配置 OPENAI_API_KEY 后会启用在线 AI 教练。`
    });
  }

  try {
    const payload = {
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "你是热爱动物、熟悉幼犬习性的宠物驯养教练。用中文输出，语气温和、具体、可执行。健康建议必须保守，并明确不能替代兽医诊断。"
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "基于宠物档案和最近记录，生成今日养育建议。输出标题和 3-5 条行动建议。",
            pet,
            timelineEvents,
            weightRecords,
            reminders,
            expenses
          })
        }
      ],
      max_output_tokens: 700
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`AI request failed: ${response.status}`);
    }

    const data = await response.json();
    const text = extractOutputText(data);

    return persistInsight(petId, {
      scope: "daily",
      title: `${pet.name}今日 AI 养育建议`,
      riskLevel: "info",
      body:
        text ||
        `${fallback.body}\n\n在线 AI 没有返回可读文本，本次先使用本地规则建议。`
    });
  } catch (error) {
    return persistInsight(petId, {
      ...fallback,
      scope: "daily",
      title: `${pet.name}今日养育建议`,
      body: `${fallback.body}\n\n在线 AI 暂不可用，已回退到本地规则建议。`
    });
  }
}

async function persistInsight(petId, insight) {
  return prisma.aiInsight.create({
    data: {
      petId,
      scope: insight.scope || "daily",
      title: insight.title,
      body: insight.body,
      riskLevel: insight.riskLevel || "info",
      generatedAt: new Date()
    }
  });
}
