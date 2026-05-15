PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "BarkSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "timelineEventId" TEXT,
  "representativeSampleId" TEXT,
  "startedAt" TEXT NOT NULL,
  "endedAt" TEXT NOT NULL,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "barkCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'candidate',
  "reason" TEXT,
  "summary" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "BarkSession_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BarkSession_petId_startedAt_idx" ON "BarkSession" ("petId", "startedAt");
CREATE INDEX IF NOT EXISTS "BarkSession_status_idx" ON "BarkSession" ("status");

ALTER TABLE "BarkSample" ADD COLUMN "sessionId" TEXT;

CREATE INDEX IF NOT EXISTS "BarkSample_sessionId_idx" ON "BarkSample" ("sessionId");
