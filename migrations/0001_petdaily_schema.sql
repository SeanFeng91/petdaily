PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "PetProfile" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "breed" TEXT NOT NULL,
  "sex" TEXT NOT NULL,
  "birthday" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "currentWeight" REAL,
  "notes" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "TimelineEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "happenedAt" TEXT NOT NULL,
  "amount" REAL,
  "unit" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "photoUrl" TEXT,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "TimelineEvent_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TimelineEvent_petId_happenedAt_idx" ON "TimelineEvent" ("petId", "happenedAt");
CREATE INDEX IF NOT EXISTS "TimelineEvent_type_idx" ON "TimelineEvent" ("type");

CREATE TABLE IF NOT EXISTS "Reminder" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "scheduledTime" TEXT NOT NULL,
  "weekdays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
  "active" INTEGER NOT NULL DEFAULT 1,
  "nextDueAt" TEXT,
  "note" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "Reminder_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Reminder_petId_active_idx" ON "Reminder" ("petId", "active");

CREATE TABLE IF NOT EXISTS "WeightRecord" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "measuredAt" TEXT NOT NULL,
  "weightKg" REAL NOT NULL,
  "note" TEXT,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "WeightRecord_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WeightRecord_petId_measuredAt_idx" ON "WeightRecord" ("petId", "measuredAt");

CREATE TABLE IF NOT EXISTS "Expense" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "purchasedAt" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "Expense_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Expense_petId_purchasedAt_idx" ON "Expense" ("petId", "purchasedAt");
CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense" ("category");

CREATE TABLE IF NOT EXISTS "PhotoAsset" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "caption" TEXT,
  "takenAt" TEXT NOT NULL,
  "linkedEventId" TEXT,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "PhotoAsset_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PhotoAsset_petId_takenAt_idx" ON "PhotoAsset" ("petId", "takenAt");

CREATE TABLE IF NOT EXISTS "AiInsight" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL DEFAULT 'info',
  "generatedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "AiInsight_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AiInsight_petId_generatedAt_idx" ON "AiInsight" ("petId", "generatedAt");
CREATE INDEX IF NOT EXISTS "AiInsight_scope_idx" ON "AiInsight" ("scope");
