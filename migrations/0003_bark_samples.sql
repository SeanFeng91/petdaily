PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "BarkCluster" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "label" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unlabeled',
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "centroid" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "BarkCluster_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BarkCluster_petId_status_idx" ON "BarkCluster" ("petId", "status");

CREATE TABLE IF NOT EXISTS "BarkSample" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "clusterId" TEXT,
  "timelineEventId" TEXT,
  "audioUrl" TEXT,
  "audioObjectKey" TEXT,
  "audioContentType" TEXT,
  "features" TEXT NOT NULL DEFAULT '{}',
  "embedding" TEXT NOT NULL DEFAULT '[]',
  "waveform" TEXT NOT NULL DEFAULT '[]',
  "barkScore" REAL NOT NULL DEFAULT 0,
  "detectorVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'candidate',
  "reason" TEXT,
  "note" TEXT,
  "capturedAt" TEXT NOT NULL,
  "durationMs" INTEGER,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "BarkSample_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BarkSample_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "BarkCluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BarkSample_petId_capturedAt_idx" ON "BarkSample" ("petId", "capturedAt");
CREATE INDEX IF NOT EXISTS "BarkSample_clusterId_idx" ON "BarkSample" ("clusterId");
CREATE INDEX IF NOT EXISTS "BarkSample_status_idx" ON "BarkSample" ("status");
