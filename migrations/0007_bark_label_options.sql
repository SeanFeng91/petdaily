CREATE TABLE IF NOT EXISTS "BarkLabelOption" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "petId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "builtIn" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "BarkLabelOption_petId_fkey" FOREIGN KEY ("petId") REFERENCES "PetProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BarkLabelOption_petId_idx" ON "BarkLabelOption" ("petId");
