import { getAgeText, getLocalCoachSummary } from "@/lib/domain";
import { getD1Database } from "@/lib/cloudflare";

function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeDate(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function normalizeAmount(value) {
  if (value === "" || value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeExpenseCents(value, fallback = 0) {
  if (value === "" || value == null) return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : fallback;
}

function normalizeD1Pet(row) {
  return row
    ? {
        ...row,
        birthday: row.birthday,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    : null;
}

function normalizeD1Reminder(row) {
  return row
    ? {
        ...row,
        active: normalizeBoolean(row.active),
        lastDoneAt: row.lastDoneAt || null
      }
    : null;
}

async function getPrisma() {
  const { prisma } = await import("./prisma.js");
  return prisma;
}

async function getRuntime() {
  const d1 = await getD1Database();
  if (d1) return { kind: "d1", db: d1 };
  return { kind: "sqlite", db: await getPrisma() };
}

async function d1All(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

async function d1First(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

async function d1Run(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).run();
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

function buildDashboard({ pet, timelineEvents, reminders, weightRecords, expenses, photos, insights }) {
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEvents = timelineEvents.filter((event) => new Date(event.happenedAt) >= todayStart);
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

export async function getDashboardData() {
  const runtime = await getRuntime();

  if (runtime.kind === "d1") {
    const pet = normalizeD1Pet(
      await d1First(runtime.db, 'SELECT * FROM "PetProfile" ORDER BY "createdAt" ASC LIMIT 1')
    );

    if (!pet) {
      return buildDashboard({
        pet: null,
        timelineEvents: [],
        reminders: [],
        weightRecords: [],
        expenses: [],
        photos: [],
        insights: []
      });
    }

    const [timelineEvents, reminders, weightRecords, expenses, photos, insights] = await Promise.all([
      d1All(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "petId" = ? ORDER BY "happenedAt" DESC LIMIT 80', [pet.id]),
      d1All(runtime.db, 'SELECT * FROM "Reminder" WHERE "petId" = ? ORDER BY "active" DESC, "scheduledTime" ASC', [pet.id]),
      d1All(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "petId" = ? ORDER BY "measuredAt" ASC LIMIT 30', [pet.id]),
      d1All(runtime.db, 'SELECT * FROM "Expense" WHERE "petId" = ? ORDER BY "purchasedAt" DESC LIMIT 80', [pet.id]),
      d1All(runtime.db, 'SELECT * FROM "PhotoAsset" WHERE "petId" = ? ORDER BY "takenAt" DESC LIMIT 40', [pet.id]),
      d1All(runtime.db, 'SELECT * FROM "AiInsight" WHERE "petId" = ? ORDER BY "generatedAt" DESC LIMIT 10', [pet.id])
    ]);

    return buildDashboard({
      pet,
      timelineEvents,
      reminders: reminders.map(normalizeD1Reminder),
      weightRecords,
      expenses,
      photos,
      insights
    });
  }

  const pet = await runtime.db.petProfile.findFirst({
    orderBy: { createdAt: "asc" }
  });

  if (!pet) {
    return buildDashboard({
      pet: null,
      timelineEvents: [],
      reminders: [],
      weightRecords: [],
      expenses: [],
      photos: [],
      insights: []
    });
  }

  const [timelineEvents, reminders, weightRecords, expenses, photos, insights] = await Promise.all([
    runtime.db.timelineEvent.findMany({
      where: { petId: pet.id },
      orderBy: { happenedAt: "desc" },
      take: 80
    }),
    runtime.db.reminder.findMany({
      where: { petId: pet.id },
      orderBy: [{ active: "desc" }, { scheduledTime: "asc" }]
    }),
    runtime.db.weightRecord.findMany({
      where: { petId: pet.id },
      orderBy: { measuredAt: "asc" },
      take: 30
    }),
    runtime.db.expense.findMany({
      where: { petId: pet.id },
      orderBy: { purchasedAt: "desc" },
      take: 80
    }),
    runtime.db.photoAsset.findMany({
      where: { petId: pet.id },
      orderBy: { takenAt: "desc" },
      take: 40
    }),
    runtime.db.aiInsight.findMany({
      where: { petId: pet.id },
      orderBy: { generatedAt: "desc" },
      take: 10
    })
  ]);

  return buildDashboard({ pet, timelineEvents, reminders, weightRecords, expenses, photos, insights });
}

export async function listPets() {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    const pets = await d1All(runtime.db, 'SELECT * FROM "PetProfile" ORDER BY "createdAt" ASC');
    return pets.map(normalizeD1Pet);
  }

  return runtime.db.petProfile.findMany({ orderBy: { createdAt: "asc" } });
}

export async function savePetProfile(body) {
  const runtime = await getRuntime();
  const timestamp = nowIso();
  const data = {
    id: body.id || createId("pet"),
    name: body.name?.trim() || "小西高地",
    breed: body.breed?.trim() || "西高地白梗",
    sex: body.sex?.trim() || "female",
    birthday: normalizeDate(body.birthday || "2026-02-05"),
    avatarUrl: body.avatarUrl?.trim() || null,
    currentWeight: body.currentWeight ? Number(body.currentWeight) : null,
    notes: body.notes?.trim() || null
  };

  if (runtime.kind === "d1") {
    if (body.id) {
      await d1Run(
        runtime.db,
        'UPDATE "PetProfile" SET "name" = ?, "breed" = ?, "sex" = ?, "birthday" = ?, "avatarUrl" = ?, "currentWeight" = ?, "notes" = ?, "updatedAt" = ? WHERE "id" = ?',
        [data.name, data.breed, data.sex, data.birthday, data.avatarUrl, data.currentWeight, data.notes, timestamp, data.id]
      );
    } else {
      await d1Run(
        runtime.db,
        'INSERT INTO "PetProfile" ("id", "name", "breed", "sex", "birthday", "avatarUrl", "currentWeight", "notes", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [data.id, data.name, data.breed, data.sex, data.birthday, data.avatarUrl, data.currentWeight, data.notes, timestamp, timestamp]
      );
    }

    return normalizeD1Pet(await d1First(runtime.db, 'SELECT * FROM "PetProfile" WHERE "id" = ?', [data.id]));
  }

  return body.id
    ? runtime.db.petProfile.update({
        where: { id: body.id },
        data: {
          name: data.name,
          breed: data.breed,
          sex: data.sex,
          birthday: new Date(data.birthday),
          avatarUrl: data.avatarUrl,
          currentWeight: data.currentWeight,
          notes: data.notes
        }
      })
    : runtime.db.petProfile.create({
        data: {
          name: data.name,
          breed: data.breed,
          sex: data.sex,
          birthday: new Date(data.birthday),
          avatarUrl: data.avatarUrl,
          currentWeight: data.currentWeight,
          notes: data.notes
        }
      });
}

export async function listTimelineEvents(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    return petId
      ? d1All(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "petId" = ? ORDER BY "happenedAt" DESC LIMIT 100', [petId])
      : d1All(runtime.db, 'SELECT * FROM "TimelineEvent" ORDER BY "happenedAt" DESC LIMIT 100');
  }

  return runtime.db.timelineEvent.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { happenedAt: "desc" },
    take: 100
  });
}

export async function createTimelineEvent(body) {
  const runtime = await getRuntime();
  const timestamp = nowIso();
  const happenedAt = normalizeDate(body.happenedAt || timestamp);
  const amount = normalizeAmount(body.amount);
  const type = body.type || "NOTE";
  const event = {
    id: createId("event"),
    petId: body.petId,
    type,
    title: body.title?.trim() || "新记录",
    note: body.note?.trim() || null,
    happenedAt,
    amount,
    unit: body.unit?.trim() || null,
    metadata: JSON.stringify(body.metadata || {}),
    photoUrl: body.photoUrl?.trim() || null,
    createdAt: timestamp
  };
  let weightRecord = null;
  let photoAsset = null;

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "TimelineEvent" ("id", "petId", "type", "title", "note", "happenedAt", "amount", "unit", "metadata", "photoUrl", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [event.id, event.petId, event.type, event.title, event.note, event.happenedAt, event.amount, event.unit, event.metadata, event.photoUrl, event.createdAt]
    );

    if (type === "WEIGHT" && amount != null) {
      weightRecord = {
        id: createId("weight"),
        petId: event.petId,
        measuredAt: happenedAt,
        weightKg: amount,
        note: event.note,
        createdAt: timestamp
      };
      await d1Run(
        runtime.db,
        'INSERT INTO "WeightRecord" ("id", "petId", "measuredAt", "weightKg", "note", "createdAt") VALUES (?, ?, ?, ?, ?, ?)',
        [weightRecord.id, weightRecord.petId, weightRecord.measuredAt, weightRecord.weightKg, weightRecord.note, weightRecord.createdAt]
      );
      await d1Run(runtime.db, 'UPDATE "PetProfile" SET "currentWeight" = ?, "updatedAt" = ? WHERE "id" = ?', [
        amount,
        timestamp,
        event.petId
      ]);
    }

    if (event.photoUrl) {
      photoAsset = {
        id: createId("photo"),
        petId: event.petId,
        url: event.photoUrl,
        caption: event.title || event.note || "成长照片",
        takenAt: happenedAt,
        linkedEventId: event.id,
        createdAt: timestamp
      };
      await d1Run(
        runtime.db,
        'INSERT INTO "PhotoAsset" ("id", "petId", "url", "caption", "takenAt", "linkedEventId", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        [photoAsset.id, photoAsset.petId, photoAsset.url, photoAsset.caption, photoAsset.takenAt, photoAsset.linkedEventId, photoAsset.createdAt]
      );
    }

    return { event, weightRecord, photoAsset };
  }

  const created = await runtime.db.timelineEvent.create({
    data: {
      petId: event.petId,
      type: event.type,
      title: event.title,
      note: event.note,
      happenedAt: new Date(event.happenedAt),
      amount: event.amount,
      unit: event.unit,
      metadata: event.metadata,
      photoUrl: event.photoUrl
    }
  });

  if (type === "WEIGHT" && amount != null) {
    weightRecord = await runtime.db.weightRecord.create({
      data: {
        petId: event.petId,
        measuredAt: new Date(event.happenedAt),
        weightKg: amount,
        note: event.note
      }
    });
    await runtime.db.petProfile.update({
      where: { id: event.petId },
      data: { currentWeight: amount }
    });
  }

  if (event.photoUrl) {
    photoAsset = await runtime.db.photoAsset.create({
      data: {
        petId: event.petId,
        url: event.photoUrl,
        caption: event.title || event.note || "成长照片",
        takenAt: new Date(event.happenedAt),
        linkedEventId: created.id
      }
    });
  }

  return { event: created, weightRecord, photoAsset };
}

export async function deleteTimelineEvent(id) {
  const runtime = await getRuntime();

  if (runtime.kind === "d1") {
    const event = await d1First(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "id" = ?', [id]);
    if (!event) return { id, deleted: false };

    await d1Run(runtime.db, 'DELETE FROM "PhotoAsset" WHERE "linkedEventId" = ?', [id]);

    if (event.type === "WEIGHT" && event.amount != null) {
      await d1Run(
        runtime.db,
        'DELETE FROM "WeightRecord" WHERE "petId" = ? AND "measuredAt" = ? AND "weightKg" = ?',
        [event.petId, event.happenedAt, event.amount]
      );
    }

    await d1Run(runtime.db, 'DELETE FROM "TimelineEvent" WHERE "id" = ?', [id]);

    if (event.type === "WEIGHT") {
      const latest = await d1First(
        runtime.db,
        'SELECT "weightKg" FROM "WeightRecord" WHERE "petId" = ? ORDER BY "measuredAt" DESC LIMIT 1',
        [event.petId]
      );
      await d1Run(runtime.db, 'UPDATE "PetProfile" SET "currentWeight" = ?, "updatedAt" = ? WHERE "id" = ?', [
        latest?.weightKg ?? null,
        nowIso(),
        event.petId
      ]);
    }

    return { id, deleted: true, type: event.type, petId: event.petId };
  }

  const event = await runtime.db.timelineEvent.findUnique({ where: { id } });
  if (!event) return { id, deleted: false };

  await runtime.db.photoAsset.deleteMany({ where: { linkedEventId: id } });

  if (event.type === "WEIGHT" && event.amount != null) {
    await runtime.db.weightRecord.deleteMany({
      where: {
        petId: event.petId,
        measuredAt: event.happenedAt,
        weightKg: event.amount
      }
    });
  }

  await runtime.db.timelineEvent.delete({ where: { id } });

  if (event.type === "WEIGHT") {
    const latest = await runtime.db.weightRecord.findFirst({
      where: { petId: event.petId },
      orderBy: { measuredAt: "desc" }
    });
    await runtime.db.petProfile.update({
      where: { id: event.petId },
      data: { currentWeight: latest?.weightKg ?? null }
    });
  }

  return { id, deleted: true, type: event.type, petId: event.petId };
}

async function getLatestWeightValue(runtime, petId) {
  if (runtime.kind === "d1") {
    const latest = await d1First(
      runtime.db,
      'SELECT "weightKg" FROM "WeightRecord" WHERE "petId" = ? ORDER BY "measuredAt" DESC LIMIT 1',
      [petId]
    );
    return latest?.weightKg ?? null;
  }

  const latest = await runtime.db.weightRecord.findFirst({
    where: { petId },
    orderBy: { measuredAt: "desc" }
  });
  return latest?.weightKg ?? null;
}

async function findMatchingWeightTimelineEvent(runtime, weight) {
  if (runtime.kind === "d1") {
    return d1First(
      runtime.db,
      'SELECT * FROM "TimelineEvent" WHERE "petId" = ? AND "type" = ? AND "happenedAt" = ? AND "amount" = ? ORDER BY "createdAt" DESC LIMIT 1',
      [weight.petId, "WEIGHT", weight.measuredAt, weight.weightKg]
    );
  }

  return runtime.db.timelineEvent.findFirst({
    where: {
      petId: weight.petId,
      type: "WEIGHT",
      happenedAt: weight.measuredAt,
      amount: weight.weightKg
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function listWeightRecords(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    return petId
      ? d1All(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "petId" = ? ORDER BY "measuredAt" ASC LIMIT 100', [petId])
      : d1All(runtime.db, 'SELECT * FROM "WeightRecord" ORDER BY "measuredAt" ASC LIMIT 100');
  }

  return runtime.db.weightRecord.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { measuredAt: "asc" },
    take: 100
  });
}

export async function updateWeightRecord(body) {
  const runtime = await getRuntime();
  const weightKg = normalizeAmount(body.weightKg);
  if (weightKg == null) throw new Error("Valid weightKg is required");

  if (runtime.kind === "d1") {
    const existing = await d1First(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "id" = ?', [body.id]);
    if (!existing) throw new Error("Weight record not found");

    const matchingEvent = await findMatchingWeightTimelineEvent(runtime, existing);
    const measuredAt = normalizeDate(body.measuredAt || existing.measuredAt);
    const note = body.note === undefined ? existing.note : normalizeOptionalText(body.note);

    await d1Run(
      runtime.db,
      'UPDATE "WeightRecord" SET "measuredAt" = ?, "weightKg" = ?, "note" = ? WHERE "id" = ?',
      [measuredAt, weightKg, note, body.id]
    );

    let timelineEvent = null;
    if (matchingEvent) {
      await d1Run(
        runtime.db,
        'UPDATE "TimelineEvent" SET "happenedAt" = ?, "amount" = ?, "unit" = ?, "note" = ? WHERE "id" = ?',
        [measuredAt, weightKg, "kg", note, matchingEvent.id]
      );
      timelineEvent = await d1First(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "id" = ?', [matchingEvent.id]);
    }

    const currentWeightKg = await getLatestWeightValue(runtime, existing.petId);
    await d1Run(runtime.db, 'UPDATE "PetProfile" SET "currentWeight" = ?, "updatedAt" = ? WHERE "id" = ?', [
      currentWeightKg,
      nowIso(),
      existing.petId
    ]);

    const weight = await d1First(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "id" = ?', [body.id]);
    return { weight, timelineEvent, currentWeightKg };
  }

  const existing = await runtime.db.weightRecord.findUnique({ where: { id: body.id } });
  if (!existing) throw new Error("Weight record not found");

  const matchingEvent = await findMatchingWeightTimelineEvent(runtime, existing);
  const measuredAt = normalizeDate(body.measuredAt || existing.measuredAt);
  const note = body.note === undefined ? existing.note : normalizeOptionalText(body.note);

  const weight = await runtime.db.weightRecord.update({
    where: { id: body.id },
    data: {
      measuredAt: new Date(measuredAt),
      weightKg,
      note
    }
  });

  let timelineEvent = null;
  if (matchingEvent) {
    timelineEvent = await runtime.db.timelineEvent.update({
      where: { id: matchingEvent.id },
      data: {
        happenedAt: new Date(measuredAt),
        amount: weightKg,
        unit: "kg",
        note
      }
    });
  }

  const currentWeightKg = await getLatestWeightValue(runtime, existing.petId);
  await runtime.db.petProfile.update({
    where: { id: existing.petId },
    data: { currentWeight: currentWeightKg }
  });

  return { weight, timelineEvent, currentWeightKg };
}

export async function deleteWeightRecord(id) {
  const runtime = await getRuntime();

  if (runtime.kind === "d1") {
    const existing = await d1First(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "id" = ?', [id]);
    if (!existing) return { id, deleted: false, timelineEventIds: [], currentWeightKg: null };

    const matchingEvent = await findMatchingWeightTimelineEvent(runtime, existing);
    if (matchingEvent) {
      await d1Run(runtime.db, 'DELETE FROM "TimelineEvent" WHERE "id" = ?', [matchingEvent.id]);
    }
    await d1Run(runtime.db, 'DELETE FROM "WeightRecord" WHERE "id" = ?', [id]);

    const currentWeightKg = await getLatestWeightValue(runtime, existing.petId);
    await d1Run(runtime.db, 'UPDATE "PetProfile" SET "currentWeight" = ?, "updatedAt" = ? WHERE "id" = ?', [
      currentWeightKg,
      nowIso(),
      existing.petId
    ]);

    return {
      id,
      deleted: true,
      petId: existing.petId,
      timelineEventIds: matchingEvent ? [matchingEvent.id] : [],
      currentWeightKg
    };
  }

  const existing = await runtime.db.weightRecord.findUnique({ where: { id } });
  if (!existing) return { id, deleted: false, timelineEventIds: [], currentWeightKg: null };

  const matchingEvent = await findMatchingWeightTimelineEvent(runtime, existing);
  if (matchingEvent) {
    await runtime.db.timelineEvent.delete({ where: { id: matchingEvent.id } });
  }
  await runtime.db.weightRecord.delete({ where: { id } });

  const currentWeightKg = await getLatestWeightValue(runtime, existing.petId);
  await runtime.db.petProfile.update({
    where: { id: existing.petId },
    data: { currentWeight: currentWeightKg }
  });

  return {
    id,
    deleted: true,
    petId: existing.petId,
    timelineEventIds: matchingEvent ? [matchingEvent.id] : [],
    currentWeightKg
  };
}

export async function listReminders(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    const reminders = petId
      ? await d1All(runtime.db, 'SELECT * FROM "Reminder" WHERE "petId" = ? ORDER BY "active" DESC, "scheduledTime" ASC', [petId])
      : await d1All(runtime.db, 'SELECT * FROM "Reminder" ORDER BY "active" DESC, "scheduledTime" ASC');
    return reminders.map(normalizeD1Reminder);
  }

  return runtime.db.reminder.findMany({
    where: petId ? { petId } : undefined,
    orderBy: [{ active: "desc" }, { scheduledTime: "asc" }]
  });
}

export async function createReminder(body) {
  const runtime = await getRuntime();
  const timestamp = nowIso();
  const reminder = {
    id: createId("reminder"),
    petId: body.petId,
    kind: body.kind || "FOOD",
    title: body.title?.trim() || "新提醒",
    scheduledTime: body.scheduledTime || "08:00",
    weekdays: body.weekdays || "1,2,3,4,5,6,7",
    active: true,
    nextDueAt: normalizeDate(body.nextDueAt),
    lastDoneAt: null,
    note: body.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "Reminder" ("id", "petId", "kind", "title", "scheduledTime", "weekdays", "active", "nextDueAt", "lastDoneAt", "note", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        reminder.id,
        reminder.petId,
        reminder.kind,
        reminder.title,
        reminder.scheduledTime,
        reminder.weekdays,
        1,
        reminder.nextDueAt,
        reminder.lastDoneAt,
        reminder.note,
        reminder.createdAt,
        reminder.updatedAt
      ]
    );
    return reminder;
  }

  return runtime.db.reminder.create({
    data: {
      petId: reminder.petId,
      kind: reminder.kind,
      title: reminder.title,
      scheduledTime: reminder.scheduledTime,
      weekdays: reminder.weekdays,
      nextDueAt: reminder.nextDueAt ? new Date(reminder.nextDueAt) : null,
      lastDoneAt: reminder.lastDoneAt,
      note: reminder.note
    }
  });
}

export async function updateReminder(body) {
  const runtime = await getRuntime();
  const timestamp = nowIso();

  if (runtime.kind === "d1") {
    const existing = normalizeD1Reminder(await d1First(runtime.db, 'SELECT * FROM "Reminder" WHERE "id" = ?', [body.id]));
    if (!existing) throw new Error("Reminder not found");
    const active = typeof body.active === "boolean" ? body.active : existing.active;
    const title = body.title?.trim() || existing.title;
    const scheduledTime = body.scheduledTime || existing.scheduledTime;
    const lastDoneAt =
      body.complete === true
        ? timestamp
        : body.resetDone === true
          ? null
          : existing.lastDoneAt;
    const note = body.note?.trim() || existing.note;

    await d1Run(
      runtime.db,
      'UPDATE "Reminder" SET "active" = ?, "title" = ?, "scheduledTime" = ?, "lastDoneAt" = ?, "note" = ?, "updatedAt" = ? WHERE "id" = ?',
      [active ? 1 : 0, title, scheduledTime, lastDoneAt, note, timestamp, body.id]
    );

    return normalizeD1Reminder(await d1First(runtime.db, 'SELECT * FROM "Reminder" WHERE "id" = ?', [body.id]));
  }

  return runtime.db.reminder.update({
    where: { id: body.id },
    data: {
      active: typeof body.active === "boolean" ? body.active : undefined,
      title: body.title?.trim() || undefined,
      scheduledTime: body.scheduledTime || undefined,
      lastDoneAt: body.complete === true ? new Date(timestamp) : body.resetDone === true ? null : undefined,
      note: body.note?.trim() || undefined
    }
  });
}

export async function deleteReminder(id) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    await d1Run(runtime.db, 'DELETE FROM "Reminder" WHERE "id" = ?', [id]);
    return { id };
  }

  await runtime.db.reminder.delete({ where: { id } });
  return { id };
}

export async function listExpenses(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    return petId
      ? d1All(runtime.db, 'SELECT * FROM "Expense" WHERE "petId" = ? ORDER BY "purchasedAt" DESC LIMIT 100', [petId])
      : d1All(runtime.db, 'SELECT * FROM "Expense" ORDER BY "purchasedAt" DESC LIMIT 100');
  }

  return runtime.db.expense.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { purchasedAt: "desc" },
    take: 100
  });
}

export async function createExpense(body) {
  const runtime = await getRuntime();
  const timestamp = nowIso();
  const expense = {
    id: createId("expense"),
    petId: body.petId,
    category: body.category || "DAILY",
    itemName: body.itemName?.trim() || "宠物用品",
    amountCents: normalizeExpenseCents(body.amount),
    purchasedAt: normalizeDate(body.purchasedAt || timestamp),
    note: body.note?.trim() || null,
    createdAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "Expense" ("id", "petId", "category", "itemName", "amountCents", "purchasedAt", "note", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [expense.id, expense.petId, expense.category, expense.itemName, expense.amountCents, expense.purchasedAt, expense.note, expense.createdAt]
    );
    return expense;
  }

  return runtime.db.expense.create({
    data: {
      petId: expense.petId,
      category: expense.category,
      itemName: expense.itemName,
      amountCents: expense.amountCents,
      purchasedAt: new Date(expense.purchasedAt),
      note: expense.note
    }
  });
}

export async function updateExpense(body) {
  const runtime = await getRuntime();

  if (runtime.kind === "d1") {
    const existing = await d1First(runtime.db, 'SELECT * FROM "Expense" WHERE "id" = ?', [body.id]);
    if (!existing) throw new Error("Expense not found");

    const category = body.category || existing.category;
    const itemName = body.itemName?.trim() || existing.itemName;
    const amountCents = normalizeExpenseCents(body.amount, existing.amountCents);
    const purchasedAt = normalizeDate(body.purchasedAt || existing.purchasedAt);
    const note = body.note === undefined ? existing.note : normalizeOptionalText(body.note);

    await d1Run(
      runtime.db,
      'UPDATE "Expense" SET "category" = ?, "itemName" = ?, "amountCents" = ?, "purchasedAt" = ?, "note" = ? WHERE "id" = ?',
      [category, itemName, amountCents, purchasedAt, note, body.id]
    );

    return d1First(runtime.db, 'SELECT * FROM "Expense" WHERE "id" = ?', [body.id]);
  }

  const existing = await runtime.db.expense.findUnique({ where: { id: body.id } });
  if (!existing) throw new Error("Expense not found");

  return runtime.db.expense.update({
    where: { id: body.id },
    data: {
      category: body.category || existing.category,
      itemName: body.itemName?.trim() || existing.itemName,
      amountCents: normalizeExpenseCents(body.amount, existing.amountCents),
      purchasedAt: new Date(normalizeDate(body.purchasedAt || existing.purchasedAt)),
      note: body.note === undefined ? existing.note : normalizeOptionalText(body.note)
    }
  });
}

export async function deleteExpense(id) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    const existing = await d1First(runtime.db, 'SELECT * FROM "Expense" WHERE "id" = ?', [id]);
    if (!existing) return { id, deleted: false };
    await d1Run(runtime.db, 'DELETE FROM "Expense" WHERE "id" = ?', [id]);
    return { id, deleted: true, petId: existing.petId };
  }

  const existing = await runtime.db.expense.findUnique({ where: { id } });
  if (!existing) return { id, deleted: false };
  await runtime.db.expense.delete({ where: { id } });
  return { id, deleted: true, petId: existing.petId };
}

export async function listPhotos(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    return petId
      ? d1All(runtime.db, 'SELECT * FROM "PhotoAsset" WHERE "petId" = ? ORDER BY "takenAt" DESC LIMIT 80', [petId])
      : d1All(runtime.db, 'SELECT * FROM "PhotoAsset" ORDER BY "takenAt" DESC LIMIT 80');
  }

  return runtime.db.photoAsset.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { takenAt: "desc" },
    take: 80
  });
}

export async function createPhoto(body) {
  const runtime = await getRuntime();
  const timestamp = nowIso();
  const eventId = createId("event");
  const photo = {
    id: createId("photo"),
    petId: body.petId,
    url: body.url.trim(),
    caption: body.caption?.trim() || "成长照片",
    takenAt: normalizeDate(body.takenAt || timestamp),
    linkedEventId: eventId,
    createdAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "PhotoAsset" ("id", "petId", "url", "caption", "takenAt", "linkedEventId", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
      [photo.id, photo.petId, photo.url, photo.caption, photo.takenAt, photo.linkedEventId, photo.createdAt]
    );
    await d1Run(
      runtime.db,
      'INSERT INTO "TimelineEvent" ("id", "petId", "type", "title", "note", "happenedAt", "amount", "unit", "metadata", "photoUrl", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [eventId, photo.petId, "PHOTO", photo.caption, null, photo.takenAt, null, null, JSON.stringify({ photoId: photo.id }), photo.url, timestamp]
    );
    return photo;
  }

  const created = await runtime.db.photoAsset.create({
    data: {
      petId: photo.petId,
      url: photo.url,
      caption: photo.caption,
      takenAt: new Date(photo.takenAt),
      linkedEventId: eventId
    }
  });

  await runtime.db.timelineEvent.create({
    data: {
      id: eventId,
      petId: photo.petId,
      type: "PHOTO",
      title: photo.caption,
      happenedAt: new Date(photo.takenAt),
      photoUrl: photo.url,
      metadata: JSON.stringify({ photoId: created.id })
    }
  });

  return created;
}

export async function deletePhoto(id) {
  const runtime = await getRuntime();

  if (runtime.kind === "d1") {
    const photo = await d1First(runtime.db, 'SELECT * FROM "PhotoAsset" WHERE "id" = ?', [id]);
    if (photo?.linkedEventId) {
      await d1Run(runtime.db, 'DELETE FROM "TimelineEvent" WHERE "id" = ?', [photo.linkedEventId]);
    }
    await d1Run(runtime.db, 'DELETE FROM "PhotoAsset" WHERE "id" = ?', [id]);
    return { id, linkedEventId: photo?.linkedEventId || null };
  }

  const photo = await runtime.db.photoAsset.findUnique({ where: { id } });
  if (photo?.linkedEventId) {
    await runtime.db.timelineEvent.deleteMany({ where: { id: photo.linkedEventId } });
  }
  await runtime.db.photoAsset.delete({ where: { id } });
  return { id, linkedEventId: photo?.linkedEventId || null };
}

export async function listInsights(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    return petId
      ? d1All(runtime.db, 'SELECT * FROM "AiInsight" WHERE "petId" = ? ORDER BY "generatedAt" DESC LIMIT 20', [petId])
      : d1All(runtime.db, 'SELECT * FROM "AiInsight" ORDER BY "generatedAt" DESC LIMIT 20');
  }

  return runtime.db.aiInsight.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { generatedAt: "desc" },
    take: 20
  });
}

export async function getCoachContext(petId) {
  const runtime = await getRuntime();
  if (runtime.kind === "d1") {
    const [pet, timelineEvents, weightRecords, reminders, expenses] = await Promise.all([
      d1First(runtime.db, 'SELECT * FROM "PetProfile" WHERE "id" = ?', [petId]),
      d1All(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "petId" = ? ORDER BY "happenedAt" DESC LIMIT 30', [petId]),
      d1All(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "petId" = ? ORDER BY "measuredAt" ASC LIMIT 20', [petId]),
      d1All(runtime.db, 'SELECT * FROM "Reminder" WHERE "petId" = ? ORDER BY "scheduledTime" ASC', [petId]),
      d1All(runtime.db, 'SELECT * FROM "Expense" WHERE "petId" = ? ORDER BY "purchasedAt" DESC LIMIT 20', [petId])
    ]);
    return {
      pet: normalizeD1Pet(pet),
      timelineEvents,
      weightRecords,
      reminders: reminders.map(normalizeD1Reminder),
      expenses
    };
  }

  const [pet, timelineEvents, weightRecords, reminders, expenses] = await Promise.all([
    runtime.db.petProfile.findUnique({ where: { id: petId } }),
    runtime.db.timelineEvent.findMany({
      where: { petId },
      orderBy: { happenedAt: "desc" },
      take: 30
    }),
    runtime.db.weightRecord.findMany({
      where: { petId },
      orderBy: { measuredAt: "asc" },
      take: 20
    }),
    runtime.db.reminder.findMany({
      where: { petId },
      orderBy: { scheduledTime: "asc" }
    }),
    runtime.db.expense.findMany({
      where: { petId },
      orderBy: { purchasedAt: "desc" },
      take: 20
    })
  ]);

  return { pet, timelineEvents, weightRecords, reminders, expenses };
}

export async function createInsight(petId, insight) {
  const runtime = await getRuntime();
  const timestamp = nowIso();
  const row = {
    id: createId("insight"),
    petId,
    scope: insight.scope || "daily",
    title: insight.title,
    body: insight.body,
    riskLevel: insight.riskLevel || "info",
    generatedAt: timestamp,
    createdAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "AiInsight" ("id", "petId", "scope", "title", "body", "riskLevel", "generatedAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.id, row.petId, row.scope, row.title, row.body, row.riskLevel, row.generatedAt, row.createdAt]
    );
    return row;
  }

  return runtime.db.aiInsight.create({
    data: {
      petId,
      scope: row.scope,
      title: row.title,
      body: row.body,
      riskLevel: row.riskLevel,
      generatedAt: new Date(row.generatedAt)
    }
  });
}
