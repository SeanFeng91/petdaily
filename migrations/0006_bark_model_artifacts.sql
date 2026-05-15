PRAGMA foreign_keys = ON;

ALTER TABLE "BarkSample" ADD COLUMN "audioSizeBytes" INTEGER;

CREATE TABLE IF NOT EXISTS "BarkModelArtifact" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "modelType" TEXT NOT NULL,
  "artifact" TEXT NOT NULL DEFAULT '{}',
  "metrics" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'active',
  "trainedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "BarkModelArtifact_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BarkModelArtifact_petId_modelType_status_idx" ON "BarkModelArtifact" ("petId", "modelType", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "BarkModelArtifact_petId_version_modelType_key" ON "BarkModelArtifact" ("petId", "version", "modelType");
