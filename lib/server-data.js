import { prisma } from "@/lib/prisma";
import { getAgeText, getLocalCoachSummary } from "@/lib/domain";

function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function getExpenseSummary(expenses) {
  const byCategory = new Map();
  let totalCents = 0;

  for (const expense of expenses) {
    totalCents += expense.amountCents;
    byCategory.set(expense.category, (byCategory.get(expense.category) || 0) + expense.amountCents);
  }

  return {
    totalCents,
    byCategory: Array.from(byCategory.entries()).map(([category, amountCents]) => ({
      category,
      amountCents
    }))
  };
}

export async function getDashboardData() {
  const pet = await prisma.petProfile.findFirst({
    orderBy: { createdAt: "asc" }
  });

  if (!pet) {
    return {
      pet: null,
      timelineEvents: [],
      reminders: [],
      weightRecords: [],
      expenses: [],
      photos: [],
      insights: [],
      metrics: null,
      localCoach: null
    };
  }

  const [timelineEvents, reminders, weightRecords, expenses, photos, insights] = await Promise.all([
    prisma.timelineEvent.findMany({
      where: { petId: pet.id },
      orderBy: { happenedAt: "desc" },
      take: 80
    }),
    prisma.reminder.findMany({
      where: { petId: pet.id },
      orderBy: [{ active: "desc" }, { scheduledTime: "asc" }]
    }),
    prisma.weightRecord.findMany({
      where: { petId: pet.id },
      orderBy: { measuredAt: "asc" },
      take: 30
    }),
    prisma.expense.findMany({
      where: { petId: pet.id },
      orderBy: { purchasedAt: "desc" },
      take: 80
    }),
    prisma.photoAsset.findMany({
      where: { petId: pet.id },
      orderBy: { takenAt: "desc" },
      take: 40
    }),
    prisma.aiInsight.findMany({
      where: { petId: pet.id },
      orderBy: { generatedAt: "desc" },
      take: 10
    })
  ]);

  const todayStart = startOfToday();
  const todayEvents = timelineEvents.filter((event) => event.happenedAt >= todayStart);
  const latestWeight = weightRecords.at(-1);
  const previousWeight = weightRecords.at(-2);
  const expenseSummary = getExpenseSummary(expenses);

  return serialize({
    pet,
    timelineEvents,
    reminders,
    weightRecords,
    expenses,
    photos,
    insights,
    metrics: {
      ageText: getAgeText(pet.birthday),
      todayEventCount: todayEvents.length,
      activeReminderCount: reminders.filter((item) => item.active).length,
      latestWeightKg: latestWeight?.weightKg ?? pet.currentWeight,
      weightDeltaKg:
        latestWeight && previousWeight
          ? Number((latestWeight.weightKg - previousWeight.weightKg).toFixed(2))
          : null,
      expenseSummary
    },
    localCoach: getLocalCoachSummary({ pet, timelineEvents, weightRecords, reminders })
  });
}
