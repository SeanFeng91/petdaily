PRAGMA foreign_keys = ON;

ALTER TABLE "BarkSample" ADD COLUMN "spectrogram" TEXT NOT NULL DEFAULT '[]';
