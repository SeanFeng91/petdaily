import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  const env = readFileSync(".env", "utf8");
  const match = env.match(/^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|(.+))$/m);
  process.env.DATABASE_URL = match?.[1] || match?.[2] || match?.[3];
}

const prisma = new PrismaClient();

const petBirthday = new Date("2026-02-05T08:00:00+08:00");
const petName = "豆包";

const day = (date, hour = 8, minute = 0) => new Date(`2026-05-${String(date).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);

async function main() {
  await prisma.aiInsight.deleteMany();
  await prisma.photoAsset.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.weightRecord.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.timelineEvent.deleteMany();
  await prisma.petProfile.deleteMany();

  const pet = await prisma.petProfile.create({
    data: {
      name: petName,
      breed: "西高地白梗",
      sex: "female",
      birthday: petBirthday,
      avatarUrl: "/photos/westie-portrait.svg",
      currentWeight: 3.2,
      notes: "3 个月幼犬，正在建立定点如厕、少量多餐和外出适应。"
    }
  });

  const weightRecords = [
    [21, 2.82],
    [24, 2.93],
    [27, 3.02],
    [30, 3.11],
    [3, 3.2]
  ];

  for (const [date, weightKg] of weightRecords) {
    const monthDate = date > 20 ? `2026-04-${date}` : `2026-05-${String(date).padStart(2, "0")}`;
    await prisma.weightRecord.create({
      data: {
        petId: pet.id,
        measuredAt: new Date(`${monthDate}T08:10:00+08:00`),
        weightKg,
        note: "早餐前称重，记录条件保持一致。"
      }
    });
  }

  const reminders = [
    ["FOOD", "早餐 45g 幼犬粮", "07:30", "少量温水泡软，观察食欲。"],
    ["POTTY", "早餐后外出如厕", "08:05", "饭后 15-30 分钟带到固定地点。"],
    ["FOOD", "午间训练零食", "12:30", "用于召回和坐下训练，不超过全天热量 10%。"],
    ["FOOD", "晚餐 45g 幼犬粮", "18:30", "晚餐后避免剧烈运动。"],
    ["POTTY", "睡前如厕", "22:00", "降低夜间笼内尿垫压力。"],
    ["DEWORM", "下一次体内外驱虫", "09:00", "按兽医建议确认剂量。"]
  ];

  for (const [kind, title, scheduledTime, note] of reminders) {
    await prisma.reminder.create({
      data: {
        petId: pet.id,
        kind,
        title,
        scheduledTime,
        note,
        nextDueAt: kind === "DEWORM" ? day(18, 9, 0) : null
      }
    });
  }

  const timelineEvents = [
    ["FOOD", "早餐完成", day(4, 7, 38), 45, "g", "幼犬粮泡软，5 分钟吃完。"],
    ["POTTY", "饭后尿尿", day(4, 8, 18), 1, "次", "在楼下草地完成，奖励及时。"],
    ["STOOL", "便便成型", day(4, 8, 32), 1, "次", "颜色正常，形态偏软但成型。"],
    ["NOTE", "笼内安静训练", day(4, 14, 20), null, null, "午睡前哼叫 2 分钟后安静。"],
    ["FOOD", "晚餐完成", day(4, 18, 35), 45, "g", "食欲稳定。"],
    ["POTTY", "睡前尿尿", day(4, 22, 8), 1, "次", "固定口令有效。"],
    ["WEIGHT", "早餐前称重", day(3, 8, 10), 3.2, "kg", "保持同一电子秤。"],
    ["FOOD", "早餐完成", day(5, 7, 35), 44, "g", "精神好，未挑食。"],
    ["POTTY", "饭后尿尿", day(5, 8, 9), 1, "次", "比昨天更快进入状态。"],
    ["PHOTO", "第一次认真看镜头", day(5, 9, 20), null, null, "耳朵还没完全立稳。"],
    ["STOOL", "上午便便", day(5, 10, 18), 1, "次", "状态正常。"],
    ["FOOD", "晚餐完成", day(5, 18, 30), 45, "g", "饭后 20 分钟外出。"],
    ["VACCINE", "疫苗记录复核", day(1, 16, 0), null, null, "已记录下一次加强针时间，实际以宠物医院为准。"],
    ["DEWORM", "体外驱虫观察", day(2, 9, 15), null, null, "滴剂后 48 小时内避免洗澡。"]
  ];

  for (const [type, title, happenedAt, amount, unit, note] of timelineEvents) {
    await prisma.timelineEvent.create({
      data: {
        petId: pet.id,
        type,
        title,
        happenedAt,
        amount,
        unit,
        note,
        photoUrl: type === "PHOTO" ? "/photos/westie-window.svg" : null,
        metadata: "{}"
      }
    });
  }

  const photos = [
    ["/photos/westie-portrait.svg", "到家第一天，先熟悉气味。", day(1, 11, 0)],
    ["/photos/westie-window.svg", "窗边观察新世界。", day(5, 9, 20)],
    ["/photos/westie-training.svg", "坐下训练第 4 天。", day(3, 16, 30)],
    ["/photos/westie-sleep.svg", "睡前终于安静下来。", day(4, 22, 20)]
  ];

  for (const [url, caption, takenAt] of photos) {
    await prisma.photoAsset.create({
      data: {
        petId: pet.id,
        url,
        caption,
        takenAt
      }
    });
  }

  const expenses = [
    ["FOOD", "幼犬粮 2kg", 23800, day(1, 20, 0), "主粮先按原主人品牌过渡。"],
    ["DAILY", "尿垫 100 片", 6900, day(2, 11, 0), "定点如厕阶段消耗较快。"],
    ["TOY", "嗅闻垫", 8800, day(3, 15, 20), "用于消耗精力。"],
    ["MEDICAL", "疫苗复核挂号", 6000, day(1, 16, 0), "确认下一针时间。"],
    ["GROOMING", "针梳和指甲剪", 5200, day(4, 13, 40), "开始适应触碰护理。"]
  ];

  for (const [category, itemName, amountCents, purchasedAt, note] of expenses) {
    await prisma.expense.create({
      data: {
        petId: pet.id,
        category,
        itemName,
        amountCents,
        purchasedAt,
        note
      }
    });
  }

  await prisma.aiInsight.create({
    data: {
      petId: pet.id,
      scope: "daily",
      title: `${petName}今日养育建议`,
      body:
        "饮食和如厕记录已经能形成基本节奏。继续把饭后 15-30 分钟外出固定下来，并每周固定早餐前称重。健康相关判断不能替代兽医诊断；若出现持续腹泻、呕吐、拒食或精神差，请及时联系兽医。",
      riskLevel: "info",
      generatedAt: day(5, 10, 0)
    }
  });

  console.log(`Seeded PetDaily demo data for ${pet.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
