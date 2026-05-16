import { getAgeText, getLocalCoachSummary } from "@/lib/domain";
import { getBarkAudioBucket, getD1Database } from "@/lib/cloudflare";
import { BARK_SESSION_CONFIG, buildBarkEmbedding as buildAcousticBarkEmbedding, getBarkAcousticProfile } from "@/lib/bark-analysis";
import { DEFAULT_BARK_LABEL_OPTIONS, mergeBarkLabelOptions, normalizeBarkLabelId, normalizeBarkLabelOption } from "@/lib/bark-label-options";
import { BARK_MODEL_TYPE, predictBarkModel, trainBarkModel } from "@/lib/bark-model";

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

async function ensureD1BarkLabelTable(db) {
  await d1Run(
    db,
    'CREATE TABLE IF NOT EXISTS "BarkLabelOption" ("id" TEXT PRIMARY KEY NOT NULL, "petId" TEXT NOT NULL, "label" TEXT NOT NULL, "builtIn" INTEGER NOT NULL DEFAULT 0, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL)'
  );
  await d1Run(db, 'CREATE INDEX IF NOT EXISTS "BarkLabelOption_petId_idx" ON "BarkLabelOption" ("petId")');
}

async function ensureSqliteBarkLabelTable(db) {
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "BarkLabelOption" ("id" TEXT PRIMARY KEY NOT NULL, "petId" TEXT NOT NULL, "label" TEXT NOT NULL, "builtIn" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  );
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "BarkLabelOption_petId_idx" ON "BarkLabelOption" ("petId")');
}

function normalizeBarkLabelRow(row) {
  return row
    ? {
        id: row.id,
        petId: row.petId,
        label: row.label,
        builtIn: normalizeBoolean(row.builtIn),
        createdAt: normalizeDate(row.createdAt),
        updatedAt: normalizeDate(row.updatedAt)
      }
    : null;
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
        lastDoneAt: row.lastDoneAt || null,
        lastSkippedAt: row.lastSkippedAt || null
      }
    : null;
}

function normalizeTimelineEvent(row) {
  return row
    ? {
        ...row,
        metadata: JSON.stringify(normalizeStructuredField(row.metadata)),
        createdAt: normalizeDateString(row.createdAt),
        happenedAt: normalizeDateString(row.happenedAt)
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

async function getD1TableColumns(db, tableName) {
  try {
    const rows = await d1All(db, `PRAGMA table_info("${tableName}")`);
    return new Set(rows.map((row) => row.name).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function ensureD1Column(db, tableName, columnName, columnDefinition) {
  const columns = await getD1TableColumns(db, tableName);
  if (!columns.size || columns.has(columnName)) return;
  await d1Run(db, `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}`);
}

async function ensureSqliteColumn(db, tableName, columnName, columnDefinition) {
  const rows = await db.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
  const columns = new Set(rows.map((row) => row.name).filter(Boolean));
  if (!columns.size || columns.has(columnName)) return;
  await db.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}`);
}

async function ensureBarkSampleSchema(runtime) {
  if (runtime.kind === "d1") {
    await ensureD1Column(runtime.db, "BarkSample", "sessionId", "TEXT");
    await ensureD1Column(runtime.db, "BarkSample", "audioSizeBytes", "INTEGER");
    await ensureD1Column(runtime.db, "BarkSample", "spectrogram", "TEXT NOT NULL DEFAULT '[]'");
    await d1Run(runtime.db, 'CREATE INDEX IF NOT EXISTS "BarkSample_sessionId_idx" ON "BarkSample" ("sessionId")');
    return;
  }

  await ensureSqliteColumn(runtime.db, "BarkSample", "sessionId", "TEXT");
  await ensureSqliteColumn(runtime.db, "BarkSample", "audioSizeBytes", "INTEGER");
  await ensureSqliteColumn(runtime.db, "BarkSample", "spectrogram", "TEXT NOT NULL DEFAULT '[]'");
  await runtime.db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "BarkSample_sessionId_idx" ON "BarkSample" ("sessionId")');
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

  const normalizedTimelineEvents = timelineEvents.map(normalizeTimelineEvent).filter(Boolean);
  const todayEvents = normalizedTimelineEvents.filter((event) => new Date(event.happenedAt) >= todayStart);
  const latestWeight = weightRecords.at(-1);
  const previousWeight = weightRecords.at(-2);
  const expenseSummary = getExpenseSummary(expenses);

  return serialize({
    pet,
    timelineEvents: normalizedTimelineEvents,
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
    localCoach: getLocalCoachSummary({ pet, timelineEvents: normalizedTimelineEvents, weightRecords, reminders })
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
    const rows = petId
      ? d1All(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "petId" = ? ORDER BY "happenedAt" DESC LIMIT 100', [petId])
      : d1All(runtime.db, 'SELECT * FROM "TimelineEvent" ORDER BY "happenedAt" DESC LIMIT 100');
    return (await rows).map(normalizeTimelineEvent).filter(Boolean);
  }

  const rows = await runtime.db.timelineEvent.findMany({
    where: petId ? { petId } : undefined,
    orderBy: { happenedAt: "desc" },
    take: 100
  });
  return rows.map(normalizeTimelineEvent).filter(Boolean);
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

    return { event: normalizeTimelineEvent(event), weightRecord, photoAsset };
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

  return { event: normalizeTimelineEvent(created), weightRecord, photoAsset };
}

export async function updateTimelineEvent(id, body) {
  const runtime = await getRuntime();

  async function syncWeightRecordFromTimeline(existingEvent, nextEvent) {
    if (existingEvent.type !== "WEIGHT" || existingEvent.amount == null) {
      return { weightRecord: null, currentWeightKg: null };
    }

    if (runtime.kind === "d1") {
      const weightRecord = await d1First(
        runtime.db,
        'SELECT * FROM "WeightRecord" WHERE "petId" = ? AND "measuredAt" = ? AND "weightKg" = ? ORDER BY "createdAt" DESC LIMIT 1',
        [existingEvent.petId, existingEvent.happenedAt, existingEvent.amount]
      );
      if (!weightRecord) {
        return { weightRecord: null, currentWeightKg: await getLatestWeightValue(runtime, existingEvent.petId) };
      }

      await d1Run(
        runtime.db,
        'UPDATE "WeightRecord" SET "measuredAt" = ?, "weightKg" = ?, "note" = ? WHERE "id" = ?',
        [nextEvent.happenedAt, nextEvent.amount, nextEvent.note, weightRecord.id]
      );
      const updatedWeight = await d1First(runtime.db, 'SELECT * FROM "WeightRecord" WHERE "id" = ?', [weightRecord.id]);
      const currentWeightKg = await getLatestWeightValue(runtime, existingEvent.petId);
      await d1Run(runtime.db, 'UPDATE "PetProfile" SET "currentWeight" = ?, "updatedAt" = ? WHERE "id" = ?', [
        currentWeightKg,
        nowIso(),
        existingEvent.petId
      ]);
      return { weightRecord: updatedWeight, currentWeightKg };
    }

    const weightRecord = await runtime.db.weightRecord.findFirst({
      where: {
        petId: existingEvent.petId,
        measuredAt: existingEvent.happenedAt,
        weightKg: existingEvent.amount
      },
      orderBy: { createdAt: "desc" }
    });
    if (!weightRecord) {
      return { weightRecord: null, currentWeightKg: await getLatestWeightValue(runtime, existingEvent.petId) };
    }

    const updatedWeight = await runtime.db.weightRecord.update({
      where: { id: weightRecord.id },
      data: {
        measuredAt: new Date(nextEvent.happenedAt),
        weightKg: nextEvent.amount,
        note: nextEvent.note
      }
    });
    const currentWeightKg = await getLatestWeightValue(runtime, existingEvent.petId);
    await runtime.db.petProfile.update({
      where: { id: existingEvent.petId },
      data: { currentWeight: currentWeightKg }
    });
    return { weightRecord: updatedWeight, currentWeightKg };
  }

  if (runtime.kind === "d1") {
    const existing = await d1First(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "id" = ?', [id]);
    if (!existing) return { event: null };

    const title = body.title?.trim() || existing.title;
    const note = body.note === undefined ? existing.note : normalizeOptionalText(body.note);
    const resolvedAmount = body.amount != null ? normalizeAmount(body.amount) : existing.amount;
    const amount = existing.type === "WEIGHT" && resolvedAmount == null ? existing.amount : resolvedAmount;
    const unit = existing.type === "WEIGHT" ? "kg" : body.unit?.trim() ?? existing.unit;
    const happenedAt = body.happenedAt ? normalizeDate(body.happenedAt) : existing.happenedAt;
    const metadata =
      body.metadata === undefined
        ? existing.metadata
        : JSON.stringify(normalizeStructuredField(body.metadata));

    await d1Run(
      runtime.db,
      'UPDATE "TimelineEvent" SET "title" = ?, "note" = ?, "amount" = ?, "unit" = ?, "happenedAt" = ?, "metadata" = ? WHERE "id" = ?',
      [title, note, amount, unit, happenedAt, metadata, id]
    );

    const updated = await d1First(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "id" = ?', [id]);
    const normalizedEvent = normalizeTimelineEvent(updated);
    const { weightRecord, currentWeightKg } = await syncWeightRecordFromTimeline(existing, normalizedEvent);
    return { event: normalizedEvent, weightRecord, currentWeightKg };
  }

  const existing = await runtime.db.timelineEvent.findUnique({ where: { id } });
  if (!existing) return { event: null };

  const resolvedAmount = body.amount != null ? normalizeAmount(body.amount) : existing.amount;
  const updated = await runtime.db.timelineEvent.update({
    where: { id },
    data: {
      title: body.title?.trim() || existing.title,
      note: body.note === undefined ? existing.note : normalizeOptionalText(body.note),
      amount: existing.type === "WEIGHT" && resolvedAmount == null ? existing.amount : resolvedAmount,
      unit: existing.type === "WEIGHT" ? "kg" : body.unit?.trim() ?? existing.unit,
      metadata: body.metadata === undefined ? existing.metadata : JSON.stringify(normalizeStructuredField(body.metadata)),
      happenedAt: body.happenedAt ? new Date(normalizeDate(body.happenedAt)) : existing.happenedAt
    }
  });

  const normalizedEvent = normalizeTimelineEvent(updated);
  const { weightRecord, currentWeightKg } = await syncWeightRecordFromTimeline(existing, normalizedEvent);
  return { event: normalizedEvent, weightRecord, currentWeightKg };
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
      timelineEvent = normalizeTimelineEvent(await d1First(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "id" = ?', [matchingEvent.id]));
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
    timelineEvent = normalizeTimelineEvent(await runtime.db.timelineEvent.update({
      where: { id: matchingEvent.id },
      data: {
        happenedAt: new Date(measuredAt),
        amount: weightKg,
        unit: "kg",
        note
      }
    }));
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
    lastSkippedAt: null,
    note: body.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "Reminder" ("id", "petId", "kind", "title", "scheduledTime", "weekdays", "active", "nextDueAt", "lastDoneAt", "lastSkippedAt", "note", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        reminder.lastSkippedAt,
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
      lastSkippedAt: reminder.lastSkippedAt,
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
    const lastSkippedAt =
      body.skip === true
        ? timestamp
        : body.resetSkip === true
          ? null
          : existing.lastSkippedAt;
    const note = body.note?.trim() || existing.note;

    await d1Run(
      runtime.db,
      'UPDATE "Reminder" SET "active" = ?, "title" = ?, "scheduledTime" = ?, "lastDoneAt" = ?, "lastSkippedAt" = ?, "note" = ?, "updatedAt" = ? WHERE "id" = ?',
      [active ? 1 : 0, title, scheduledTime, lastDoneAt, lastSkippedAt, note, timestamp, body.id]
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
      lastSkippedAt: body.skip === true ? new Date(timestamp) : body.resetSkip === true ? null : undefined,
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
      timelineEvents: timelineEvents.map(normalizeTimelineEvent).filter(Boolean),
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

  return { pet, timelineEvents: timelineEvents.map(normalizeTimelineEvent).filter(Boolean), weightRecords, reminders, expenses };
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

const BARK_CLUSTER_THRESHOLD = 0.82;
const BARK_SAMPLE_LIMIT = 160;
const BARK_SESSION_LIMIT = 80;

function parseJsonField(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeNumberArray(value, limit = 64) {
  const source = Array.isArray(value) ? value : parseJsonField(value, []);
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, limit);
}

function normalizeSpectrogram(value, frameLimit = 96, bandLimit = 32) {
  const source = Array.isArray(value) ? value : parseJsonField(value, []);
  if (!Array.isArray(source)) return [];
  return source
    .map((frame) => normalizeNumberArray(frame, bandLimit))
    .filter((frame) => frame.length)
    .slice(0, frameLimit);
}

function normalizeStructuredField(value) {
  const parsed = typeof value === "string" ? parseJsonField(value, {}) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function normalizeDateString(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeBarkCluster(row) {
  return row
    ? {
        ...row,
        sampleCount: Number(row.sampleCount || 0),
        centroid: normalizeNumberArray(row.centroid, 48),
        createdAt: normalizeDateString(row.createdAt),
        updatedAt: normalizeDateString(row.updatedAt)
      }
    : null;
}

function normalizeBarkSession(row) {
  return row
    ? {
        ...row,
        sampleCount: Number(row.sampleCount || 0),
        barkCount: Number(row.barkCount || 0),
        summary: normalizeStructuredField(row.summary),
        startedAt: normalizeDateString(row.startedAt),
        endedAt: normalizeDateString(row.endedAt),
        createdAt: normalizeDateString(row.createdAt),
        updatedAt: normalizeDateString(row.updatedAt)
      }
    : null;
}

function normalizeBarkSample(row) {
  if (!row) return null;
  const features = normalizeStructuredField(row.features);
  return {
    ...row,
    barkScore: Number(row.barkScore || 0),
    durationMs: row.durationMs == null ? null : Number(row.durationMs),
    audioSizeBytes: row.audioSizeBytes == null ? null : Number(row.audioSizeBytes),
    features,
    embedding: normalizeNumberArray(row.embedding, 48),
    waveform: normalizeNumberArray(row.waveform, 180),
    spectrogram: normalizeSpectrogram(row.spectrogram || features.spectrogram, 96, 32),
    capturedAt: normalizeDateString(row.capturedAt),
    createdAt: normalizeDateString(row.createdAt)
  };
}

function normalizeBarkModelArtifact(row) {
  return row
    ? {
        ...row,
        artifact: normalizeStructuredField(row.artifact),
        metrics: normalizeStructuredField(row.metrics),
        trainedAt: normalizeDateString(row.trainedAt),
        createdAt: normalizeDateString(row.createdAt),
        updatedAt: normalizeDateString(row.updatedAt)
      }
    : null;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aMagnitude += a[index] ** 2;
    bMagnitude += b[index] ** 2;
  }
  if (!aMagnitude || !bMagnitude) return 0;
  return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}

function averageEmbedding(current, next, currentCount) {
  const length = Math.max(current.length, next.length);
  const averaged = [];
  for (let index = 0; index < length; index += 1) {
    const currentValue = current[index] || 0;
    const nextValue = next[index] || 0;
    averaged.push(Number(((currentValue * currentCount + nextValue) / (currentCount + 1)).toFixed(5)));
  }
  return averaged;
}

function buildBarkEmbedding(features) {
  return buildAcousticBarkEmbedding(features);
}

async function getBarkClusters(runtime, petId) {
  if (runtime.kind === "d1") {
    const rows = await d1All(runtime.db, 'SELECT * FROM "BarkCluster" WHERE "petId" = ? ORDER BY "updatedAt" DESC', [petId]);
    return rows.map(normalizeBarkCluster);
  }

  const rows = await runtime.db.barkCluster.findMany({
    where: { petId },
    orderBy: { updatedAt: "desc" }
  });
  return rows.map(normalizeBarkCluster);
}

async function getActiveBarkModelArtifact(runtime, petId) {
  if (!petId) return null;
  try {
    if (runtime.kind === "d1") {
      return normalizeBarkModelArtifact(
        await d1First(
          runtime.db,
          'SELECT * FROM "BarkModelArtifact" WHERE "petId" = ? AND "modelType" = ? AND "status" = ? ORDER BY "trainedAt" DESC LIMIT 1',
          [petId, BARK_MODEL_TYPE, "active"]
        )
      );
    }

    return normalizeBarkModelArtifact(
      await runtime.db.barkModelArtifact.findFirst({
        where: { petId, modelType: BARK_MODEL_TYPE, status: "active" },
        orderBy: { trainedAt: "desc" }
      })
    );
  } catch (error) {
    if (String(error?.message || "").includes("BarkModelArtifact")) return null;
    throw error;
  }
}

function applyBarkModelPredictions(samples, modelArtifact) {
  const model = modelArtifact?.artifact;
  if (!model?.prototypes?.length) {
    return samples.map((sample) => addBarkRuleSuggestion({
      ...sample,
      modelSuggestion: null,
      modelConfidence: null,
      modelVersion: modelArtifact?.version || null
    }));
  }

  return samples.map((sample) => {
    const prediction = predictBarkModel(model, sample);
    return addBarkRuleSuggestion({
      ...sample,
      modelSuggestion: prediction?.label || null,
      modelConfidence: prediction?.confidence ?? null,
      modelVersion: prediction?.version || modelArtifact.version || null
    });
  });
}

function getBarkRuleSuggestion(sample = {}) {
  if (sample.status === "false_positive" || sample.reason === "false-positive" || sample.reason === "false_positive") return null;
  const features = sample.features || {};
  const profile = getBarkAcousticProfile(features);
  const score = Number(sample.barkScore || 0);
  const hour = Number(features.hour);
  const sinceFood = features.sinceFoodMinutes == null ? null : Number(features.sinceFoodMinutes);
  const sincePotty = features.sincePottyMinutes == null ? null : Number(features.sincePottyMinutes);
  const recentEventCount = Number(features.recentEventCount || 0);
  const candidates = [];

  if (sincePotty != null && sincePotty >= 150) {
    candidates.push({
      label: "outside",
      confidence: Math.min(0.82, 0.48 + Math.min(0.22, sincePotty / 900) + (profile.energy === "strong" ? 0.08 : 0) + (profile.burst === "sharp" ? 0.06 : 0)),
      reason: "距离上次如厕较久，且声纹偏短促/主动。"
    });
  }

  if ((sinceFood == null || sinceFood >= 210) && Number.isFinite(hour) && ((hour >= 6 && hour <= 10) || (hour >= 17 && hour <= 21))) {
    candidates.push({
      label: "food",
      confidence: Math.min(0.78, 0.46 + (sinceFood == null ? 0.04 : Math.min(0.18, sinceFood / 1200)) + (profile.energy !== "strong" ? 0.06 : 0)),
      reason: "接近常见进食时段，且距上次喂食较久。"
    });
  }

  if (score >= 0.72 && (profile.pitch === "high" || profile.texture === "noisy") && (hour >= 21 || hour <= 6)) {
    candidates.push({
      label: "fear",
      confidence: 0.68 + (profile.energy === "strong" ? 0.06 : 0),
      reason: "夜间高频或粗糙声纹更像警觉/受惊。"
    });
  }

  if (recentEventCount > 0 && profile.burst !== "steady") {
    candidates.push({
      label: "attention",
      confidence: Math.min(0.7, 0.46 + recentEventCount * 0.05 + (profile.energy === "strong" ? 0.06 : 0)),
      reason: "近期有人为记录，可能是在向主人寻求互动。"
    });
  }

  if (!candidates.length && sample.clusterId) {
    candidates.push({
      label: profile.burst === "steady" ? "bored" : "unknown",
      confidence: profile.burst === "steady" ? 0.54 : 0.42,
      reason: profile.burst === "steady" ? "同类声纹偏持续平稳，可先按无聊/等待观察。" : "已有声纹组，但上下文不足。"
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function addBarkRuleSuggestion(sample) {
  const rule = getBarkRuleSuggestion(sample);
  return {
    ...sample,
    ruleSuggestion: sample.modelSuggestion ? null : rule?.label || null,
    ruleConfidence: sample.modelSuggestion ? null : rule ? Number(rule.confidence.toFixed(4)) : null,
    ruleReason: sample.modelSuggestion ? null : rule?.reason || null
  };
}

function buildFeedbackBarkModelArtifact(samples, petId, activeModel) {
  if (activeModel?.artifact?.prototypes?.length) {
    return { artifact: activeModel, source: "artifact" };
  }

  const { model, metrics } = trainBarkModel(samples, {
    petId,
    version: `bark-live-feedback-${samples.length}`
  });
  const artifact = {
    id: "bark_live_feedback",
    petId,
    version: model.version,
    modelType: model.type,
    status: model.prototypes.length ? "feedback" : "empty",
    artifact: model,
    metrics,
    trainedAt: model.trainedAt,
    createdAt: model.trainedAt,
    updatedAt: model.trainedAt
  };
  return { artifact, source: model.prototypes.length ? "feedback" : "none" };
}

function getBarkLearningState(samples, clusters, modelArtifact, source) {
  const labeledSamples = samples.filter((sample) => sample.status === "confirmed" || sample.status === "false_positive");
  const labeledClusters = new Set(labeledSamples.map((sample) => sample.clusterId).filter(Boolean));
  const pendingClusters = clusters
    .map((cluster) => ({
      id: cluster.id,
      sampleCount: Number(cluster.sampleCount || 0),
      status: cluster.status,
      reason: cluster.reason
    }))
    .filter((cluster) => cluster.status !== "labeled" && cluster.status !== "false_positive" && !labeledClusters.has(cluster.id))
    .sort((a, b) => b.sampleCount - a.sampleCount);
  const metrics = modelArtifact?.metrics || {};
  const classCount = Number(metrics.classCount || modelArtifact?.artifact?.prototypes?.length || 0);
  const labeledSampleCount = Number(metrics.labeledSampleCount || labeledSamples.length);

  return {
    source,
    ready: classCount > 0,
    classCount,
    labeledSampleCount,
    totalSamples: samples.length,
    labeledClusterCount: labeledClusters.size,
    pendingClusterCount: pendingClusters.length,
    nextClusterId: pendingClusters[0]?.id || null,
    nextClusterSampleCount: pendingClusters[0]?.sampleCount || 0
  };
}

function applySessionModelSuggestions(sessions, samples) {
  const bySession = new Map();
  for (const sample of samples) {
    if (!sample.sessionId || (!sample.modelSuggestion && !sample.ruleSuggestion)) continue;
    const current = bySession.get(sample.sessionId);
    const confidence = Number(sample.modelConfidence ?? sample.ruleConfidence ?? 0);
    if (!current || confidence > Number(current.modelConfidence || 0)) {
      bySession.set(sample.sessionId, {
        modelSuggestion: sample.modelSuggestion || null,
        modelConfidence: confidence,
        modelVersion: sample.modelVersion || null,
        ruleSuggestion: sample.ruleSuggestion || null,
        ruleConfidence: sample.ruleConfidence ?? null,
        ruleReason: sample.ruleReason || null
      });
    }
  }

  return sessions.map((session) => ({
    ...session,
    ...(bySession.get(session.id) || {
      modelSuggestion: null,
      modelConfidence: null,
      modelVersion: null,
      ruleSuggestion: null,
      ruleConfidence: null,
      ruleReason: null
    })
  }));
}

async function getBarkSessions(runtime, petId, date) {
  if (runtime.kind === "d1") {
    const clauses = ['"petId" = ?'];
    const bindings = [petId];
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      clauses.push('"startedAt" >= ? AND "startedAt" < ?');
      bindings.push(start.toISOString(), new Date(start.getTime() + 86400000).toISOString());
    }
    const rows = await d1All(
      runtime.db,
      `SELECT * FROM "BarkSession" WHERE ${clauses.join(" AND ")} ORDER BY "startedAt" DESC LIMIT ${BARK_SESSION_LIMIT}`,
      bindings
    );
    return rows.map(normalizeBarkSession);
  }

  const where = { petId };
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    where.startedAt = {
      gte: start,
      lt: new Date(start.getTime() + 86400000)
    };
  }
  const rows = await runtime.db.barkSession.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: BARK_SESSION_LIMIT
  });
  return rows.map(normalizeBarkSession);
}

async function getBarkSampleById(runtime, id) {
  await ensureBarkSampleSchema(runtime);
  if (runtime.kind === "d1") {
    return normalizeBarkSample(await d1First(runtime.db, 'SELECT * FROM "BarkSample" WHERE "id" = ?', [id]));
  }

  return normalizeBarkSample(await runtime.db.barkSample.findUnique({ where: { id } }));
}

async function insertBarkCluster(runtime, cluster) {
  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "BarkCluster" ("id", "petId", "label", "reason", "status", "sampleCount", "centroid", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        cluster.id,
        cluster.petId,
        cluster.label,
        cluster.reason,
        cluster.status,
        cluster.sampleCount,
        JSON.stringify(cluster.centroid),
        cluster.createdAt,
        cluster.updatedAt
      ]
    );
    return cluster;
  }

  const created = await runtime.db.barkCluster.create({
    data: {
      id: cluster.id,
      petId: cluster.petId,
      label: cluster.label,
      reason: cluster.reason,
      status: cluster.status,
      sampleCount: cluster.sampleCount,
      centroid: JSON.stringify(cluster.centroid),
      createdAt: new Date(cluster.createdAt),
      updatedAt: new Date(cluster.updatedAt)
    }
  });
  return normalizeBarkCluster(created);
}

async function updateBarkClusterCentroid(runtime, cluster, embedding, timestamp) {
  const sampleCount = Number(cluster.sampleCount || 0);
  const nextCentroid = averageEmbedding(cluster.centroid || [], embedding, sampleCount);
  const nextCount = sampleCount + 1;

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'UPDATE "BarkCluster" SET "sampleCount" = ?, "centroid" = ?, "updatedAt" = ? WHERE "id" = ?',
      [nextCount, JSON.stringify(nextCentroid), timestamp, cluster.id]
    );
  } else {
    await runtime.db.barkCluster.update({
      where: { id: cluster.id },
      data: {
        sampleCount: nextCount,
        centroid: JSON.stringify(nextCentroid),
        updatedAt: new Date(timestamp)
      }
    });
  }

  return {
    ...cluster,
    sampleCount: nextCount,
    centroid: nextCentroid,
    updatedAt: timestamp
  };
}

async function assignBarkCluster(runtime, petId, embedding, timestamp) {
  const clusters = await getBarkClusters(runtime, petId);
  const nearest = clusters
    .map((cluster) => ({
      cluster,
      similarity: cosineSimilarity(embedding, cluster.centroid || [])
    }))
    .sort((a, b) => b.similarity - a.similarity)[0];

  if (nearest && nearest.similarity >= BARK_CLUSTER_THRESHOLD) {
    return updateBarkClusterCentroid(runtime, nearest.cluster, embedding, timestamp);
  }

  return insertBarkCluster(runtime, {
    id: createId("bark_cluster"),
    petId,
    label: null,
    reason: null,
    status: "unlabeled",
    sampleCount: 1,
    centroid: embedding,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function getBarkSessionSummary({ previous = {}, sample, profile, barkCountIncrement }) {
  const sampleCount = Number(previous.sampleCount || 0) + 1;
  const previousBarkCount = Number(previous.barkCount || 0);
  const barkCount = previousBarkCount + Math.max(1, Number(barkCountIncrement || 1));
  const previousScoreTotal = Number(previous.scoreTotal || 0);
  const scoreTotal = previousScoreTotal + Number(sample.barkScore || 0);
  const profileCounts = {
    ...(previous.profileCounts || {})
  };
  profileCounts[profile.key] = (profileCounts[profile.key] || 0) + 1;

  return {
    sampleCount,
    barkCount,
    scoreTotal: Number(scoreTotal.toFixed(4)),
    averageScore: Number((scoreTotal / sampleCount).toFixed(4)),
    maxScore: Math.max(Number(previous.maxScore || 0), Number(sample.barkScore || 0)),
    profileCounts,
    dominantProfile: Object.entries(profileCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || profile.key,
    dominantProfileLabel: profile.label,
    lastProfile: profile,
    detectorVersion: sample.detectorVersion,
    durationMs: sample.durationMs || previous.durationMs || null
  };
}

function getBarkSessionNote({ session, sample, profile }) {
  const score = Math.round((sample.barkScore || 0) * 100);
  return [
    `监听到一段狗叫，已合并为同一个叫声段，避免连续叫声刷屏。`,
    `本段保存 ${session.sampleCount} 段代表音频，估计包含 ${session.barkCount} 次叫声触发。`,
    `最高/最新检测分数：${score}%。声音画像：${profile.label}。`,
    `声学摘要：响度 ${Number(sample.features.rms || 0).toFixed(2)}，峰值 ${Number(sample.features.peak || 0).toFixed(2)}，频谱变化 ${Number(sample.features.spectralFlux || 0).toFixed(2)}。`,
    sample.audioUrl ? "可在声音库回放代表片段并按声音组批量校准。" : "当前浏览器未返回可保存音频片段，仅保存声学特征。"
  ].join("\n");
}

async function findRecentBarkSession(runtime, petId, capturedAt) {
  const cutoff = new Date(new Date(capturedAt).getTime() - BARK_SESSION_CONFIG.sessionGapMs).toISOString();
  if (runtime.kind === "d1") {
    return normalizeBarkSession(
      await d1First(
        runtime.db,
        'SELECT * FROM "BarkSession" WHERE "petId" = ? AND "endedAt" >= ? ORDER BY "endedAt" DESC LIMIT 1',
        [petId, cutoff]
      )
    );
  }

  return normalizeBarkSession(
    await runtime.db.barkSession.findFirst({
      where: {
        petId,
        endedAt: { gte: new Date(cutoff) }
      },
      orderBy: { endedAt: "desc" }
    })
  );
}

async function insertBarkSession(runtime, { petId, startedAt, endedAt, timestamp }) {
  const session = {
    id: createId("bark_session"),
    petId,
    timelineEventId: null,
    representativeSampleId: null,
    startedAt,
    endedAt,
    sampleCount: 0,
    barkCount: 0,
    status: "candidate",
    reason: null,
    summary: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "BarkSession" ("id", "petId", "timelineEventId", "representativeSampleId", "startedAt", "endedAt", "sampleCount", "barkCount", "status", "reason", "summary", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        session.id,
        session.petId,
        session.timelineEventId,
        session.representativeSampleId,
        session.startedAt,
        session.endedAt,
        session.sampleCount,
        session.barkCount,
        session.status,
        session.reason,
        JSON.stringify(session.summary),
        session.createdAt,
        session.updatedAt
      ]
    );
    return session;
  }

  const created = await runtime.db.barkSession.create({
    data: {
      id: session.id,
      petId: session.petId,
      timelineEventId: session.timelineEventId,
      representativeSampleId: session.representativeSampleId,
      startedAt: new Date(session.startedAt),
      endedAt: new Date(session.endedAt),
      sampleCount: session.sampleCount,
      barkCount: session.barkCount,
      status: session.status,
      reason: session.reason,
      summary: JSON.stringify(session.summary),
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt)
    }
  });
  return normalizeBarkSession(created);
}

async function updateBarkSessionAfterSample(runtime, { session, sample, profile, barkCountIncrement, timestamp }) {
  const summary = getBarkSessionSummary({
    previous: session.summary,
    sample,
    profile,
    barkCountIncrement
  });
  const sampleCount = Number(session.sampleCount || 0) + 1;
  const barkCount = Number(session.barkCount || 0) + Math.max(1, Number(barkCountIncrement || 1));
  const representativeSampleId =
    !session.representativeSampleId || sample.barkScore >= Number(session.summary?.maxScore || 0)
      ? sample.id
      : session.representativeSampleId;
  const updated = {
    ...session,
    endedAt: sample.capturedAt,
    sampleCount,
    barkCount,
    representativeSampleId,
    summary,
    updatedAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'UPDATE "BarkSession" SET "representativeSampleId" = ?, "endedAt" = ?, "sampleCount" = ?, "barkCount" = ?, "summary" = ?, "updatedAt" = ? WHERE "id" = ?',
      [representativeSampleId, sample.capturedAt, sampleCount, barkCount, JSON.stringify(summary), timestamp, session.id]
    );
    return updated;
  }

  const saved = await runtime.db.barkSession.update({
    where: { id: session.id },
    data: {
      representativeSampleId,
      endedAt: new Date(sample.capturedAt),
      sampleCount,
      barkCount,
      summary: JSON.stringify(summary),
      updatedAt: new Date(timestamp)
    }
  });
  return normalizeBarkSession(saved);
}

async function attachTimelineToBarkSession(runtime, { sessionId, timelineEventId, sampleId }) {
  if (runtime.kind === "d1") {
    await d1Run(runtime.db, 'UPDATE "BarkSession" SET "timelineEventId" = ? WHERE "id" = ?', [timelineEventId, sessionId]);
    await d1Run(runtime.db, 'UPDATE "BarkSample" SET "timelineEventId" = ? WHERE "id" = ?', [timelineEventId, sampleId]);
    return;
  }

  await Promise.all([
    runtime.db.barkSession.update({
      where: { id: sessionId },
      data: { timelineEventId }
    }),
    runtime.db.barkSample.update({
      where: { id: sampleId },
      data: { timelineEventId }
    })
  ]);
}

async function updateBarkSessionTimeline(runtime, { session, sample, profile }) {
  if (!session.timelineEventId) return null;
  const note = getBarkSessionNote({ session, sample, profile });
  const metadata = {
    kind: "bark-session",
    barkSessionId: session.id,
    representativeSampleId: session.representativeSampleId,
    latestSampleId: sample.id,
    clusterId: sample.clusterId,
    audioUrl: sample.audioUrl,
    detectorVersion: sample.detectorVersion,
    barkScore: sample.barkScore,
    sampleCount: session.sampleCount,
    barkCount: session.barkCount,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: Math.max(1000, new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()),
    profile,
    features: sample.features,
    embedding: sample.embedding
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'UPDATE "TimelineEvent" SET "note" = ?, "amount" = ?, "metadata" = ? WHERE "id" = ?',
      [note, Math.round((sample.barkScore || 0) * 100), JSON.stringify(metadata), session.timelineEventId]
    );
    return normalizeTimelineEvent(await d1First(runtime.db, 'SELECT * FROM "TimelineEvent" WHERE "id" = ?', [session.timelineEventId]));
  }

  const updated = await runtime.db.timelineEvent.update({
    where: { id: session.timelineEventId },
    data: {
      note,
      amount: Math.round((sample.barkScore || 0) * 100),
      metadata: JSON.stringify(metadata)
    }
  });
  return normalizeTimelineEvent(updated);
}

function getBarkAudioExtension(contentType) {
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

async function storeBarkAudio({ sampleId, petId, audioFile }) {
  if (!audioFile || typeof audioFile.arrayBuffer !== "function" || audioFile.size <= 0) {
    return { audioUrl: null, audioObjectKey: null, audioContentType: null, audioSizeBytes: 0 };
  }

  const arrayBuffer = await audioFile.arrayBuffer();
  if (!arrayBuffer.byteLength) {
    return { audioUrl: null, audioObjectKey: null, audioContentType: null, audioSizeBytes: 0 };
  }

  const audioContentType = audioFile.type || "audio/webm";
  const bucket = await getBarkAudioBucket();
  if (bucket) {
    const extension = getBarkAudioExtension(audioContentType);
    const audioObjectKey = `bark/${petId}/${sampleId}.${extension}`;
    await bucket.put(audioObjectKey, arrayBuffer, {
      httpMetadata: { contentType: audioContentType }
    });
    return {
      audioUrl: `/api/bark/audio/${sampleId}`,
      audioObjectKey,
      audioContentType,
      audioSizeBytes: arrayBuffer.byteLength
    };
  }

  const audioBase64 = Buffer.from(arrayBuffer).toString("base64");
  return {
    audioUrl: `data:${audioContentType};base64,${audioBase64}`,
    audioObjectKey: null,
    audioContentType,
    audioSizeBytes: arrayBuffer.byteLength
  };
}

function getBarkStatusFromReason(reason, status) {
  if (status) return status;
  if (reason === "false-positive") return "false_positive";
  if (reason) return "confirmed";
  return "candidate";
}

function getBarkNote({ features, sampleId, clusterId, audioUrl, barkScore }) {
  return [
    `监听到疑似狗叫，已进入声音库等待聚类分析。`,
    `检测分数：${Math.round(barkScore * 100)}%。样本：${sampleId}，聚类：${clusterId}。`,
    `声学摘要：响度 ${Number(features.rms || 0).toFixed(2)}，峰值 ${Number(features.peak || 0).toFixed(2)}，频谱变化 ${Number(features.spectralFlux || 0).toFixed(2)}，过零率 ${Number(features.zcr || 0).toFixed(2)}。`,
    audioUrl ? "音频片段已保存，可在监听页回放。" : "当前浏览器未返回可保存音频片段，仅保存声学特征。",
    "行为判断仅用于记录和校准，不等同于确定原因。"
  ].join("\n");
}

function getHourKey(value) {
  const hour = new Date(value).getHours();
  return Number.isFinite(hour) ? hour : 0;
}

function getBarkLibraryAnalysis(samples, clusters, sessions) {
  const clusterCounts = new Map();
  const profileCounts = new Map();
  const hourlyCounts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  let possibleHumanVoice = 0;
  let totalScore = 0;

  for (const sample of samples) {
    totalScore += Number(sample.barkScore || 0);
    hourlyCounts[getHourKey(sample.capturedAt)].count += 1;
    if (sample.clusterId) clusterCounts.set(sample.clusterId, (clusterCounts.get(sample.clusterId) || 0) + 1);

    const profile = getBarkAcousticProfile(sample.features);
    profileCounts.set(profile.key, {
      key: profile.key,
      label: profile.label,
      count: (profileCounts.get(profile.key)?.count || 0) + 1
    });
    if ((sample.features.highRatio || 0) < 0.34 && (sample.features.spectralFlux || 0) < 0.052) {
      possibleHumanVoice += 1;
    }
  }

  const byCluster = new Map();
  for (const sample of samples) {
    const key = sample.clusterId || "unclustered";
    if (!byCluster.has(key)) byCluster.set(key, []);
    byCluster.get(key).push(sample);
  }

  const clusterStats = [...byCluster.entries()]
    .map(([clusterId, groupSamples]) => {
      const cluster = clusters.find((item) => item.id === clusterId);
      const scoreTotal = groupSamples.reduce((sum, sample) => sum + Number(sample.barkScore || 0), 0);
      const profile = getBarkAcousticProfile(groupSamples[0]?.features || {});
      return {
        clusterId,
        label: cluster?.reason || cluster?.label || profile.label,
        sampleCount: groupSamples.length,
        averageScore: groupSamples.length ? Number((scoreTotal / groupSamples.length).toFixed(4)) : 0,
        profile,
        latestAt: groupSamples[0]?.capturedAt || null,
        representativeSampleId: groupSamples.sort((a, b) => Number(b.barkScore || 0) - Number(a.barkScore || 0))[0]?.id || null
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount);

  return {
    averageScore: samples.length ? Number((totalScore / samples.length).toFixed(4)) : 0,
    profileDistribution: [...profileCounts.values()].sort((a, b) => b.count - a.count),
    hourlyCounts,
    clusterStats,
    sessionStats: {
      total: sessions.length,
      averageSamples: sessions.length
        ? Number((sessions.reduce((sum, session) => sum + Number(session.sampleCount || 0), 0) / sessions.length).toFixed(2))
        : 0,
      averageBarks: sessions.length
        ? Number((sessions.reduce((sum, session) => sum + Number(session.barkCount || 0), 0) / sessions.length).toFixed(2))
        : 0
    },
    filterStats: {
      storedSamples: samples.length,
      possibleHumanVoice,
      activeProfiles: profileCounts.size,
      clusteredSamples: [...clusterCounts.values()].reduce((sum, count) => sum + count, 0)
    }
  };
}

export async function listBarkSamples({ petId, status, clusterId, date } = {}) {
  const runtime = await getRuntime();
  if (!petId) {
    return {
      samples: [],
      clusters: [],
      sessions: [],
      analysis: getBarkLibraryAnalysis([], [], []),
      summary: { total: 0, today: 0, pending: 0, clustered: 0, confirmed: 0, sessions: 0 }
    };
  }

  let samples = [];
  await ensureBarkSampleSchema(runtime);
  if (runtime.kind === "d1") {
    const clauses = ['"petId" = ?'];
    const bindings = [petId];
    if (status) {
      clauses.push('"status" = ?');
      bindings.push(status);
    }
    if (clusterId) {
      clauses.push('"clusterId" = ?');
      bindings.push(clusterId);
    }
    if (date) {
      clauses.push('"capturedAt" >= ? AND "capturedAt" < ?');
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 86400000);
      bindings.push(start.toISOString(), end.toISOString());
    }
    samples = (
      await d1All(
        runtime.db,
        `SELECT * FROM "BarkSample" WHERE ${clauses.join(" AND ")} ORDER BY "capturedAt" DESC LIMIT ${BARK_SAMPLE_LIMIT}`,
        bindings
      )
    ).map(normalizeBarkSample);
  } else {
    const where = { petId };
    if (status) where.status = status;
    if (clusterId) where.clusterId = clusterId;
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      where.capturedAt = {
        gte: start,
        lt: new Date(start.getTime() + 86400000)
      };
    }
    samples = (
      await runtime.db.barkSample.findMany({
        where,
        orderBy: { capturedAt: "desc" },
        take: BARK_SAMPLE_LIMIT
      })
    ).map(normalizeBarkSample);
  }

  const [clusters, rawSessions, activeModel] = await Promise.all([
    getBarkClusters(runtime, petId),
    getBarkSessions(runtime, petId, date),
    getActiveBarkModelArtifact(runtime, petId)
  ]);
  const feedbackModel = buildFeedbackBarkModelArtifact(samples, petId, activeModel);
  samples = applyBarkModelPredictions(samples, feedbackModel.artifact);
  const sessions = applySessionModelSuggestions(rawSessions, samples);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const summary = {
    total: samples.length,
    today: samples.filter((sample) => new Date(sample.capturedAt) >= todayStart).length,
    pending: samples.filter((sample) => sample.status === "candidate").length,
    clustered: new Set(samples.map((sample) => sample.clusterId).filter(Boolean)).size,
    confirmed: samples.filter((sample) => sample.status === "confirmed").length,
    sessions: sessions.length
  };

  return {
    samples,
    clusters,
    sessions,
    model: feedbackModel.artifact
      ? {
          version: feedbackModel.artifact.version,
          modelType: feedbackModel.artifact.modelType,
          source: feedbackModel.source,
          metrics: feedbackModel.artifact.metrics,
          trainedAt: feedbackModel.artifact.trainedAt,
          learning: getBarkLearningState(samples, clusters, feedbackModel.artifact, feedbackModel.source)
        }
      : null,
    analysis: getBarkLibraryAnalysis(samples, clusters, sessions),
    summary
  };
}

export async function createBarkSample(body, audioFile) {
  const runtime = await getRuntime();
  await ensureBarkSampleSchema(runtime);
  const timestamp = nowIso();
  const petId = body.petId;
  const capturedAt = normalizeDate(body.capturedAt || timestamp);
  const sessionStartedAt = normalizeDate(body.sessionStartedAt || capturedAt);
  const features = normalizeStructuredField(body.features);
  const embedding = normalizeNumberArray(body.embedding, 48);
  const resolvedEmbedding = embedding.length ? embedding : buildBarkEmbedding(features);
  const waveform = normalizeNumberArray(body.waveform, 180);
  const spectrogram = normalizeSpectrogram(body.spectrogram || features.spectrogram, 96, 32);
  const barkScore = Number.isFinite(Number(body.barkScore)) ? Number(body.barkScore) : 0;
  const detectorVersion = body.detectorVersion || "bark-front-v3";
  const durationMs = body.durationMs == null || body.durationMs === "" ? null : Number(body.durationMs);
  const barkCountIncrement = Math.max(1, Number(body.barkCount || body.barkCountIncrement || 1));
  const sampleId = createId("bark_sample");
  const profile = getBarkAcousticProfile(features);
  const cluster = await assignBarkCluster(runtime, petId, resolvedEmbedding, timestamp);
  const existingSession = await findRecentBarkSession(runtime, petId, capturedAt);
  const baseSession =
    existingSession ||
    (await insertBarkSession(runtime, {
      petId,
      startedAt: sessionStartedAt,
      endedAt: capturedAt,
      timestamp
    }));
  const audio = await storeBarkAudio({ sampleId, petId, audioFile });

  const sample = {
    id: sampleId,
    petId,
    clusterId: cluster.id,
    sessionId: baseSession.id,
    timelineEventId: null,
    audioUrl: audio.audioUrl,
    audioObjectKey: audio.audioObjectKey,
    audioContentType: audio.audioContentType,
    audioSizeBytes: audio.audioSizeBytes,
    features,
    embedding: resolvedEmbedding,
    waveform,
    spectrogram,
    barkScore,
    detectorVersion,
    status: "candidate",
    reason: null,
    note: normalizeOptionalText(body.note) || null,
    capturedAt,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    createdAt: timestamp
  };

  if (runtime.kind === "d1") {
    await d1Run(
      runtime.db,
      'INSERT INTO "BarkSample" ("id", "petId", "clusterId", "sessionId", "timelineEventId", "audioUrl", "audioObjectKey", "audioContentType", "audioSizeBytes", "features", "embedding", "waveform", "spectrogram", "barkScore", "detectorVersion", "status", "reason", "note", "capturedAt", "durationMs", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        sample.id,
        sample.petId,
        sample.clusterId,
        sample.sessionId,
        sample.timelineEventId,
        sample.audioUrl,
        sample.audioObjectKey,
        sample.audioContentType,
        sample.audioSizeBytes,
        JSON.stringify(sample.features),
        JSON.stringify(sample.embedding),
        JSON.stringify(sample.waveform),
        JSON.stringify(sample.spectrogram),
        sample.barkScore,
        sample.detectorVersion,
        sample.status,
        sample.reason,
        sample.note,
        sample.capturedAt,
        sample.durationMs,
        sample.createdAt
      ]
    );
  } else {
    await runtime.db.barkSample.create({
      data: {
        id: sample.id,
        petId: sample.petId,
        clusterId: sample.clusterId,
        sessionId: sample.sessionId,
        timelineEventId: sample.timelineEventId,
        audioUrl: sample.audioUrl,
        audioObjectKey: sample.audioObjectKey,
        audioContentType: sample.audioContentType,
        audioSizeBytes: sample.audioSizeBytes,
        features: JSON.stringify(sample.features),
        embedding: JSON.stringify(sample.embedding),
        waveform: JSON.stringify(sample.waveform),
        spectrogram: JSON.stringify(sample.spectrogram),
        barkScore: sample.barkScore,
        detectorVersion: sample.detectorVersion,
        status: sample.status,
        reason: sample.reason,
        note: sample.note,
        capturedAt: new Date(sample.capturedAt),
        durationMs: sample.durationMs
      }
    });
  }

  let session = await updateBarkSessionAfterSample(runtime, {
    session: baseSession,
    sample,
    profile,
    barkCountIncrement,
    timestamp
  });
  let timelineEvent = null;

  if (baseSession.timelineEventId) {
    sample.timelineEventId = baseSession.timelineEventId;
    if (runtime.kind === "d1") {
      await d1Run(runtime.db, 'UPDATE "BarkSample" SET "timelineEventId" = ? WHERE "id" = ?', [baseSession.timelineEventId, sample.id]);
    } else {
      await runtime.db.barkSample.update({
        where: { id: sample.id },
        data: { timelineEventId: baseSession.timelineEventId }
      });
    }
    timelineEvent = await updateBarkSessionTimeline(runtime, { session, sample, profile });
  } else {
    const timeline = await createTimelineEvent({
      petId,
      type: "BARK",
      title: "狗叫段",
      note: getBarkSessionNote({ session, sample, profile }),
      amount: Math.round(barkScore * 100),
      unit: "%",
      metadata: {
        kind: "bark-session",
        barkSessionId: session.id,
        representativeSampleId: session.representativeSampleId,
        latestSampleId: sample.id,
        barkSampleId: sample.id,
        clusterId: sample.clusterId,
        audioUrl: sample.audioUrl,
        detectorVersion,
        barkScore,
        sampleCount: session.sampleCount,
        barkCount: session.barkCount,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: Math.max(1000, new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()),
        profile,
        features,
        embedding: resolvedEmbedding
      },
      happenedAt: session.startedAt
    });
    timelineEvent = timeline.event;
    await attachTimelineToBarkSession(runtime, {
      sessionId: session.id,
      timelineEventId: timeline.event.id,
      sampleId: sample.id
    });
    sample.timelineEventId = timeline.event.id;
    session = {
      ...session,
      timelineEventId: timeline.event.id
    };
  }

  const activeModel = await getActiveBarkModelArtifact(runtime, petId);
  const feedbackModel = buildFeedbackBarkModelArtifact([sample], petId, activeModel);
  const [modelSample] = applyBarkModelPredictions([sample], feedbackModel.artifact);

  return {
    sample: modelSample,
    cluster,
    session,
    timelineEvent
  };
}

export async function updateBarkSample(id, body) {
  const runtime = await getRuntime();
  const existing = await getBarkSampleById(runtime, id);
  if (!existing) return { sample: null, samples: [], clusters: [] };

  const status = getBarkStatusFromReason(body.reason, body.status || existing.status);
  const reason = normalizeOptionalText(body.reason);
  const note = normalizeOptionalText(body.note);
  const applyToCluster = body.applyToCluster !== false && existing.clusterId;
  const timestamp = nowIso();

  if (runtime.kind === "d1") {
    if (applyToCluster) {
      await d1Run(
        runtime.db,
        'UPDATE "BarkSample" SET "status" = ?, "reason" = ?, "note" = ? WHERE "clusterId" = ?',
        [status, reason, note, existing.clusterId]
      );
      await d1Run(
        runtime.db,
        'UPDATE "BarkCluster" SET "status" = ?, "reason" = ?, "label" = ?, "updatedAt" = ? WHERE "id" = ?',
        [status === "false_positive" ? "false_positive" : "labeled", reason, reason, timestamp, existing.clusterId]
      );
      await d1Run(
        runtime.db,
        'UPDATE "BarkSession" SET "status" = ?, "reason" = ?, "updatedAt" = ? WHERE "id" IN (SELECT DISTINCT "sessionId" FROM "BarkSample" WHERE "clusterId" = ? AND "sessionId" IS NOT NULL)',
        [status, reason, timestamp, existing.clusterId]
      );
    } else {
      await d1Run(
        runtime.db,
        'UPDATE "BarkSample" SET "status" = ?, "reason" = ?, "note" = ? WHERE "id" = ?',
        [status, reason, note, id]
      );
      if (existing.sessionId) {
        await d1Run(
          runtime.db,
          'UPDATE "BarkSession" SET "status" = ?, "reason" = ?, "updatedAt" = ? WHERE "id" = ?',
          [status, reason, timestamp, existing.sessionId]
        );
      }
    }
  } else if (applyToCluster) {
    await runtime.db.barkSample.updateMany({
      where: { clusterId: existing.clusterId },
      data: { status, reason, note }
    });
    await runtime.db.barkCluster.update({
      where: { id: existing.clusterId },
      data: {
        status: status === "false_positive" ? "false_positive" : "labeled",
        reason,
        label: reason,
        updatedAt: new Date(timestamp)
      }
    });
    const sessionRows = await runtime.db.barkSample.findMany({
      where: { clusterId: existing.clusterId, sessionId: { not: null } },
      select: { sessionId: true }
    });
    const sessionIds = [...new Set(sessionRows.map((item) => item.sessionId).filter(Boolean))];
    if (sessionIds.length) {
      await runtime.db.barkSession.updateMany({
        where: { id: { in: sessionIds } },
        data: { status, reason, updatedAt: new Date(timestamp) }
      });
    }
  } else {
    await runtime.db.barkSample.update({
      where: { id },
      data: { status, reason, note }
    });
    if (existing.sessionId) {
      await runtime.db.barkSession.update({
        where: { id: existing.sessionId },
        data: { status, reason, updatedAt: new Date(timestamp) }
      });
    }
  }

  const sample = await getBarkSampleById(runtime, id);
  const library = await listBarkSamples({ petId: existing.petId });
  return { sample, ...library };
}

export async function listBarkLabelOptions(petId) {
  const runtime = await getRuntime();
  if (!petId) return DEFAULT_BARK_LABEL_OPTIONS;
  let rows = [];
  if (runtime.kind === "d1") {
    await ensureD1BarkLabelTable(runtime.db);
    rows = await d1All(runtime.db, 'SELECT * FROM "BarkLabelOption" WHERE "petId" = ? ORDER BY "createdAt" ASC', [petId]);
  } else {
    await ensureSqliteBarkLabelTable(runtime.db);
    rows = await runtime.db.$queryRawUnsafe('SELECT * FROM "BarkLabelOption" WHERE "petId" = ? ORDER BY "createdAt" ASC', petId);
  }
  return mergeBarkLabelOptions(rows.map(normalizeBarkLabelRow));
}

export async function createBarkLabelOption({ petId, id, label }) {
  const runtime = await getRuntime();
  const option = normalizeBarkLabelOption({ id: id || label, label });
  if (!petId || !option) throw new Error("petId and label are required");
  if (DEFAULT_BARK_LABEL_OPTIONS.some((item) => item.id === option.id)) return listBarkLabelOptions(petId);
  const timestamp = nowIso();

  if (runtime.kind === "d1") {
    await ensureD1BarkLabelTable(runtime.db);
    await d1Run(
      runtime.db,
      'INSERT OR REPLACE INTO "BarkLabelOption" ("id", "petId", "label", "builtIn", "createdAt", "updatedAt") VALUES (?, ?, ?, 0, COALESCE((SELECT "createdAt" FROM "BarkLabelOption" WHERE "id" = ?), ?), ?)',
      [option.id, petId, option.label, option.id, timestamp, timestamp]
    );
  } else {
    await ensureSqliteBarkLabelTable(runtime.db);
    await runtime.db.$executeRawUnsafe(
      'INSERT OR REPLACE INTO "BarkLabelOption" ("id", "petId", "label", "builtIn", "createdAt", "updatedAt") VALUES (?, ?, ?, false, COALESCE((SELECT "createdAt" FROM "BarkLabelOption" WHERE "id" = ?), ?), ?)',
      option.id,
      petId,
      option.label,
      option.id,
      timestamp,
      timestamp
    );
  }

  return listBarkLabelOptions(petId);
}

export async function deleteBarkLabelOption({ petId, id }) {
  const runtime = await getRuntime();
  const labelId = normalizeBarkLabelId(id);
  if (!petId || !labelId) throw new Error("petId and id are required");
  if (DEFAULT_BARK_LABEL_OPTIONS.some((item) => item.id === labelId)) return listBarkLabelOptions(petId);

  if (runtime.kind === "d1") {
    await ensureD1BarkLabelTable(runtime.db);
    await d1Run(runtime.db, 'DELETE FROM "BarkLabelOption" WHERE "petId" = ? AND "id" = ?', [petId, labelId]);
  } else {
    await ensureSqliteBarkLabelTable(runtime.db);
    await runtime.db.$executeRawUnsafe('DELETE FROM "BarkLabelOption" WHERE "petId" = ? AND "id" = ?', petId, labelId);
  }
  return listBarkLabelOptions(petId);
}

export async function rebuildBarkClusters(petId) {
  const runtime = await getRuntime();
  if (!petId) return { samples: [], clusters: [], summary: { total: 0, today: 0, pending: 0, clustered: 0, confirmed: 0 } };
  await ensureBarkSampleSchema(runtime);

  const samples =
    runtime.kind === "d1"
      ? (await d1All(runtime.db, 'SELECT * FROM "BarkSample" WHERE "petId" = ? ORDER BY "capturedAt" ASC', [petId])).map(normalizeBarkSample)
      : (
          await runtime.db.barkSample.findMany({
            where: { petId },
            orderBy: { capturedAt: "asc" }
          })
        ).map(normalizeBarkSample);

  if (runtime.kind === "d1") {
    await d1Run(runtime.db, 'UPDATE "BarkSample" SET "clusterId" = NULL WHERE "petId" = ?', [petId]);
    await d1Run(runtime.db, 'DELETE FROM "BarkCluster" WHERE "petId" = ?', [petId]);
  } else {
    await runtime.db.barkSample.updateMany({ where: { petId }, data: { clusterId: null } });
    await runtime.db.barkCluster.deleteMany({ where: { petId } });
  }

  for (const sample of samples) {
    const embedding = sample.embedding.length ? sample.embedding : buildBarkEmbedding(sample.features);
    const cluster = await assignBarkCluster(runtime, petId, embedding, nowIso());
    if (runtime.kind === "d1") {
      await d1Run(runtime.db, 'UPDATE "BarkSample" SET "clusterId" = ? WHERE "id" = ?', [cluster.id, sample.id]);
      if (sample.reason || sample.status === "false_positive") {
        await d1Run(
          runtime.db,
          'UPDATE "BarkCluster" SET "status" = ?, "reason" = ?, "label" = ?, "updatedAt" = ? WHERE "id" = ?',
          [sample.status === "false_positive" ? "false_positive" : "labeled", sample.reason, sample.reason, nowIso(), cluster.id]
        );
      }
    } else {
      await runtime.db.barkSample.update({
        where: { id: sample.id },
        data: { clusterId: cluster.id }
      });
      if (sample.reason || sample.status === "false_positive") {
        await runtime.db.barkCluster.update({
          where: { id: cluster.id },
          data: {
            status: sample.status === "false_positive" ? "false_positive" : "labeled",
            reason: sample.reason,
            label: sample.reason,
            updatedAt: new Date()
          }
        });
      }
    }
  }

  return listBarkSamples({ petId });
}

export async function getBarkAudio(id) {
  const runtime = await getRuntime();
  const sample = await getBarkSampleById(runtime, id);
  if (!sample) return null;

  if (sample.audioObjectKey) {
    const bucket = await getBarkAudioBucket();
    const object = bucket ? await bucket.get(sample.audioObjectKey) : null;
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    return {
      body: bytes,
      contentType: sample.audioContentType || object.httpMetadata?.contentType || "audio/webm",
      size: bytes.byteLength,
      sample
    };
  }

  if (sample.audioUrl?.startsWith("data:")) {
    const [header, data] = sample.audioUrl.split(",");
    const contentType = header.match(/^data:([^;]+)/)?.[1] || sample.audioContentType || "audio/webm";
    const bytes = Buffer.from(data || "", "base64");
    return {
      body: bytes,
      contentType,
      size: bytes.byteLength,
      sample
    };
  }

  return null;
}
