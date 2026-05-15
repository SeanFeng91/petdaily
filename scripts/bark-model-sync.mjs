import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { BARK_MODEL_TYPE, trainBarkModel } from "../lib/bark-model.js";

const root = process.cwd();
const syncDir = resolve(root, "data/bark-sync");
const audioDir = resolve(syncDir, "audio");
const mode = process.argv[2] || "sync";

function readJson(path, fallback = []) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readRequiredNodeMajor() {
  const raw = existsSync(".nvmrc") ? readFileSync(".nvmrc", "utf8").trim() : "22";
  return Number(raw.match(/\d+/)?.[0] || 22);
}

function assertNodeVersion() {
  const required = readRequiredNodeMajor();
  const current = Number(process.versions.node.split(".")[0]);
  if (current < required) {
    throw new Error(`当前 Node.js 是 ${process.version}，请先执行 nvm use（项目要求 ${required}+）后再运行。`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.encoding || "utf8",
    stdio: options.stdio || "pipe"
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout || "";
}

function runWrangler(args, options = {}) {
  return run("npx", ["wrangler", ...args], options);
}

function extractD1Rows(output) {
  const payload = JSON.parse(output);
  const records = Array.isArray(payload) ? payload : [payload];
  return records.flatMap((item) => item.results || item.result?.results || item.result?.[0]?.results || []);
}

function sqlString(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getAudioExtension(sample) {
  const type = sample.audioContentType || "";
  if (type.includes("mp4")) return ".m4a";
  if (type.includes("ogg")) return ".ogg";
  if (type.includes("wav")) return ".wav";
  return extname(sample.audioObjectKey || "") || ".webm";
}

function queryTable(tableName) {
  const output = runWrangler([
    "d1",
    "execute",
    "petdaily",
    "--remote",
    "--json",
    "--command",
    `SELECT * FROM "${tableName}";`
  ]);
  return extractD1Rows(output);
}

function download() {
  assertNodeVersion();
  mkdirSync(audioDir, { recursive: true });
  const pets = queryTable("PetProfile");
  const samples = queryTable("BarkSample");
  const sessions = queryTable("BarkSession");
  const clusters = queryTable("BarkCluster");

  saveJson(resolve(syncDir, "pets.json"), pets);
  saveJson(resolve(syncDir, "samples.json"), samples);
  saveJson(resolve(syncDir, "sessions.json"), sessions);
  saveJson(resolve(syncDir, "clusters.json"), clusters);

  const audioManifest = [];
  for (const sample of samples) {
    if (!sample.audioObjectKey) continue;
    const dest = resolve(audioDir, `${sample.id}${getAudioExtension(sample)}`);
    try {
      runWrangler(["r2", "object", "get", `petdaily-bark-audio/${sample.audioObjectKey}`, "--remote", "--file", dest]);
      audioManifest.push({ sampleId: sample.id, audioObjectKey: sample.audioObjectKey, path: dest, status: "downloaded" });
    } catch (error) {
      audioManifest.push({
        sampleId: sample.id,
        audioObjectKey: sample.audioObjectKey,
        path: dest,
        status: "missing",
        error: String(error.message || error).slice(0, 500)
      });
    }
  }
  saveJson(resolve(syncDir, "audio-manifest.json"), audioManifest);
  console.log(`Downloaded ${samples.length} bark samples, ${sessions.length} sessions, ${clusters.length} clusters.`);
}

function train() {
  const samples = readJson(resolve(syncDir, "samples.json"));
  const pets = readJson(resolve(syncDir, "pets.json"));
  const petIds = [...new Set(samples.map((sample) => sample.petId).filter(Boolean))];
  const targetPetIds = petIds.length ? petIds : pets.map((pet) => pet.id).filter(Boolean);
  const artifacts = [];

  for (const petId of targetPetIds) {
    const petSamples = samples.filter((sample) => sample.petId === petId);
    const version = `bark-local-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${petId.slice(-6)}`;
    const { model, metrics } = trainBarkModel(petSamples, { petId, version });
    artifacts.push({
      id: `bark_model_${randomUUID()}`,
      petId,
      version,
      modelType: BARK_MODEL_TYPE,
      artifact: model,
      metrics,
      status: "active",
      trainedAt: model.trainedAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  saveJson(resolve(syncDir, "model-artifacts.json"), artifacts);
  console.log(`Trained ${artifacts.length} model artifact(s).`);
}

function push() {
  assertNodeVersion();
  const artifacts = readJson(resolve(syncDir, "model-artifacts.json"));
  if (!artifacts.length) {
    console.log("No model artifacts to push.");
    return;
  }

  const sql = artifacts
    .map((artifact) => {
      const now = new Date().toISOString();
      return [
        `UPDATE "BarkModelArtifact" SET "status" = 'archived', "updatedAt" = ${sqlString(now)} WHERE "petId" = ${sqlString(artifact.petId)} AND "modelType" = ${sqlString(artifact.modelType)} AND "status" = 'active';`,
        `INSERT OR REPLACE INTO "BarkModelArtifact" ("id", "petId", "version", "modelType", "artifact", "metrics", "status", "trainedAt", "createdAt", "updatedAt") VALUES (${sqlString(artifact.id)}, ${sqlString(artifact.petId)}, ${sqlString(artifact.version)}, ${sqlString(artifact.modelType)}, ${sqlString(JSON.stringify(artifact.artifact))}, ${sqlString(JSON.stringify(artifact.metrics))}, ${sqlString(artifact.status)}, ${sqlString(artifact.trainedAt)}, ${sqlString(artifact.createdAt)}, ${sqlString(now)});`
      ].join("\n");
    })
    .join("\n");

  const sqlPath = resolve(syncDir, "push-models.sql");
  writeFileSync(sqlPath, sql);
  runWrangler(["d1", "execute", "petdaily", "--remote", "--file", sqlPath], { stdio: "inherit" });
  console.log(`Pushed ${artifacts.length} model artifact(s) to D1.`);
}

try {
  if (mode === "download") download();
  else if (mode === "train") train();
  else if (mode === "push") push();
  else if (mode === "sync") {
    download();
    train();
    push();
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
