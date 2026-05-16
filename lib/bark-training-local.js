import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { DEFAULT_BARK_LABEL_OPTIONS, mergeBarkLabelOptions, normalizeBarkLabelId, normalizeBarkLabelOption } from "@/lib/bark-label-options";
import { BARK_MODEL_TYPE, trainBarkModel } from "@/lib/bark-model";

const root = process.cwd();
const syncDir = resolve(root, "data/bark-sync");
const audioDir = resolve(syncDir, "audio");
const statusPath = resolve(syncDir, "local-training-status.json");
const reportPath = resolve(syncDir, "training-report.json");
const labelOptionsPath = resolve(syncDir, "label-options.json");
const reasonLabelMap = {
  outside: "想出去",
  food: "想吃",
  bored: "无聊",
  attention: "关注",
  fear: "警觉",
  unknown: "不确定",
  false_positive: "不是狗叫",
  "false-positive": "不是狗叫"
};

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return parseJson(readFileSync(path, "utf8"), fallback);
}

function saveJson(path, value) {
  mkdirSync(syncDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeNumberArray(value, limit = 64) {
  const source = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, limit);
}

function normalizeObject(value) {
  const parsed = typeof value === "string" ? parseJson(value, {}) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function normalizeDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function getReasonLabel(reason) {
  return reasonLabelMap[reason] || reason || "未标注";
}

function getSampleAudioUrl(sample) {
  return `/api/bark/training/local/audio/${encodeURIComponent(sample.id)}`;
}

function normalizeSample(row) {
  if (!row) return null;
  return {
    ...row,
    barkScore: Number(row.barkScore || 0),
    durationMs: row.durationMs == null ? null : Number(row.durationMs),
    audioSizeBytes: row.audioSizeBytes == null ? null : Number(row.audioSizeBytes),
    features: normalizeObject(row.features),
    embedding: normalizeNumberArray(row.embedding, 48),
    waveform: normalizeNumberArray(row.waveform, 180),
    capturedAt: normalizeDate(row.capturedAt),
    createdAt: normalizeDate(row.createdAt),
    localAudioUrl: getSampleAudioUrl(row)
  };
}

function normalizeCluster(row) {
  if (!row) return null;
  return {
    ...row,
    sampleCount: Number(row.sampleCount || 0),
    centroid: normalizeNumberArray(row.centroid, 48),
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt)
  };
}

function normalizeSession(row) {
  if (!row) return null;
  return {
    ...row,
    sampleCount: Number(row.sampleCount || 0),
    barkCount: Number(row.barkCount || 0),
    summary: normalizeObject(row.summary),
    startedAt: normalizeDate(row.startedAt),
    endedAt: normalizeDate(row.endedAt),
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt)
  };
}

function readLocalTrainingFiles() {
  const pets = readJson(resolve(syncDir, "pets.json"), []);
  const samples = readJson(resolve(syncDir, "samples.json"), []).map(normalizeSample).filter(Boolean);
  const sessions = readJson(resolve(syncDir, "sessions.json"), []).map(normalizeSession).filter(Boolean);
  const clusters = readJson(resolve(syncDir, "clusters.json"), []).map(normalizeCluster).filter(Boolean);
  const artifacts = readJson(resolve(syncDir, "model-artifacts.json"), []);
  const audioManifest = readJson(resolve(syncDir, "audio-manifest.json"), []);
  const trainingReport = readJson(reportPath, null);
  const labelOptions = mergeBarkLabelOptions(readJson(labelOptionsPath, []));
  const status = readJson(statusPath, {});
  return { pets, samples, sessions, clusters, artifacts, audioManifest, trainingReport, labelOptions, status };
}

function buildClusterEntries(samples, clusters, petId) {
  const filtered = petId ? samples.filter((sample) => sample.petId === petId) : samples;
  const byCluster = new Map();
  for (const sample of filtered) {
    const key = sample.clusterId || `unclustered-${sample.id}`;
    if (!byCluster.has(key)) byCluster.set(key, []);
    byCluster.get(key).push(sample);
  }

  return [...byCluster.entries()]
    .map(([clusterId, clusterSamples]) => {
      const representative = [...clusterSamples].sort((a, b) => Number(b.barkScore || 0) - Number(a.barkScore || 0))[0];
      const cluster = clusters.find((item) => item.id === clusterId) || null;
      const labeledCount = clusterSamples.filter((sample) => sample.reason || sample.status === "false_positive").length;
      return {
        id: clusterId,
        label: cluster?.reason || cluster?.label || getReasonLabel(representative?.reason),
        status: cluster?.status || representative?.status || "candidate",
        reason: cluster?.reason || representative?.reason || null,
        sampleCount: clusterSamples.length,
        labeledCount,
        pendingCount: clusterSamples.length - labeledCount,
        latestCapturedAt: clusterSamples[0]?.capturedAt || null,
        representativeSample: representative,
        samples: clusterSamples.slice(0, 10)
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount || Number(new Date(b.latestCapturedAt || 0)) - Number(new Date(a.latestCapturedAt || 0)));
}

function buildLabelDistribution(samples) {
  const counts = new Map();
  for (const sample of samples) {
    const key = sample.status === "false_positive" || sample.reason === "false-positive" || sample.reason === "false_positive"
      ? "false_positive"
      : sample.reason || "candidate";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: getReasonLabel(reason), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildPrototypeRows(artifacts, petId, samples) {
  const artifact = artifacts.find((item) => item.petId === petId) || artifacts[0] || null;
  const preview = trainBarkModel(samples, {
    petId,
    version: artifact?.version || `preview-${Date.now()}`
  });
  const model = artifact?.artifact?.prototypes?.length ? artifact.artifact : preview.model;
  const metrics = artifact?.metrics || preview.metrics;
  return {
    source: artifact?.artifact?.prototypes?.length ? "artifact" : "preview",
    version: artifact?.version || preview.model.version,
    trainedAt: artifact?.trainedAt || preview.model.trainedAt,
    modelType: artifact?.modelType || BARK_MODEL_TYPE,
    metrics,
    prototypes: (model?.prototypes || []).map((prototype) => ({
      ...prototype,
      labelText: getReasonLabel(prototype.label)
    }))
  };
}

export function getLocalTrainingState(petId) {
  const { pets, samples, sessions, clusters, artifacts, audioManifest, trainingReport, labelOptions, status } = readLocalTrainingFiles();
  const preferredPetId = petId || samples[0]?.petId || pets[0]?.id || null;
  let resolvedPetId = preferredPetId;
  let filteredSamples = resolvedPetId ? samples.filter((sample) => sample.petId === resolvedPetId) : samples;
  let filteredSessions = resolvedPetId ? sessions.filter((session) => session.petId === resolvedPetId) : sessions;
  let filteredClusters = resolvedPetId ? clusters.filter((cluster) => cluster.petId === resolvedPetId) : clusters;

  if (!filteredSamples.length && samples.length) {
    resolvedPetId = samples[0]?.petId || null;
    filteredSamples = resolvedPetId ? samples.filter((sample) => sample.petId === resolvedPetId) : samples;
    filteredSessions = resolvedPetId ? sessions.filter((session) => session.petId === resolvedPetId) : sessions;
    filteredClusters = resolvedPetId ? clusters.filter((cluster) => cluster.petId === resolvedPetId) : clusters;
  }

  const clusterEntries = buildClusterEntries(filteredSamples, filteredClusters, resolvedPetId);
  const labelDistribution = buildLabelDistribution(filteredSamples);
  const localModel = buildPrototypeRows(artifacts, resolvedPetId, filteredSamples);
  const labeledSamples = filteredSamples.filter((sample) => sample.reason || sample.status === "false_positive").length;
  const downloadedAudio = audioManifest.filter((item) => item.status === "downloaded").length;
  const missingAudio = audioManifest.filter((item) => item.status === "missing").length;
  const activeTrainingReport = trainingReport?.reports?.find((report) => report.petId === resolvedPetId) || trainingReport?.reports?.[0] || null;

  return {
    petId: resolvedPetId,
    available: existsSync(syncDir),
    status,
    summary: {
      sampleCount: filteredSamples.length,
      sessionCount: filteredSessions.length,
      clusterCount: filteredClusters.length,
      labeledSampleCount: labeledSamples,
      unlabeledSampleCount: Math.max(0, filteredSamples.length - labeledSamples),
      audioDownloaded: downloadedAudio,
      audioMissing: missingAudio
    },
    labelDistribution,
    labelOptions,
    localModel,
    clusters: clusterEntries,
    artifacts,
    trainingReport: activeTrainingReport,
    trainingReportGeneratedAt: trainingReport?.generatedAt || null,
    hasArtifacts: artifacts.length > 0
  };
}

export function listLocalBarkLabelOptions() {
  return mergeBarkLabelOptions(readJson(labelOptionsPath, []));
}

export function createLocalBarkLabelOption({ id, label }) {
  const option = normalizeBarkLabelOption({ id: id || label, label });
  if (!option) throw new Error("label is required");
  if (DEFAULT_BARK_LABEL_OPTIONS.some((item) => item.id === option.id)) return listLocalBarkLabelOptions();
  const current = readJson(labelOptionsPath, []);
  saveJson(labelOptionsPath, mergeBarkLabelOptions(current, [{ ...option, builtIn: false }]).filter((item) => !item.builtIn));
  return listLocalBarkLabelOptions();
}

export function deleteLocalBarkLabelOption({ id }) {
  const labelId = normalizeBarkLabelId(id);
  if (!labelId) throw new Error("id is required");
  if (DEFAULT_BARK_LABEL_OPTIONS.some((item) => item.id === labelId)) return listLocalBarkLabelOptions();
  const current = readJson(labelOptionsPath, []);
  saveJson(labelOptionsPath, current.filter((item) => item.id !== labelId));
  return listLocalBarkLabelOptions();
}

function writeTrainingStatus(payload) {
  saveJson(statusPath, payload);
}

function runLocalScript(mode) {
  const startedAt = Date.now();
  const command = `unset npm_config_prefix && source "$HOME/.nvm/nvm.sh" && nvm use >/dev/null && node scripts/bark-model-sync.mjs ${mode}`;
  const result = spawnSync("bash", ["-lc", command], {
    cwd: root,
    encoding: "utf8"
  });
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  writeTrainingStatus({
    mode,
    finishedAt,
    durationMs,
    ok: result.status === 0,
    output
  });

  if (result.status !== 0) {
    throw new Error(output || `local bark ${mode} failed`);
  }

  return {
    mode,
    finishedAt,
    durationMs,
    output
  };
}

export function runLocalTrainingAction(action, petId) {
  const run = runLocalScript(action);
  return {
    run,
    state: getLocalTrainingState(petId)
  };
}

export function updateLocalTrainingLabel({ petId, sampleId, reason, applyToCluster = true }) {
  const samplesPath = resolve(syncDir, "samples.json");
  const clustersPath = resolve(syncDir, "clusters.json");
  const sessionsPath = resolve(syncDir, "sessions.json");
  const samples = readJson(samplesPath, []);
  const clusters = readJson(clustersPath, []);
  const sessions = readJson(sessionsPath, []);
  const target = samples.find((sample) => sample.id === sampleId);

  if (!target) {
    throw new Error("local sample not found");
  }

  const nextStatus = reason === "false-positive" ? "false_positive" : "confirmed";
  const clusterId = target.clusterId;
  const sessionIds = new Set();

  for (const sample of samples) {
    const match = applyToCluster && clusterId ? sample.clusterId === clusterId : sample.id === sampleId;
    if (!match) continue;
    sample.reason = reason;
    sample.status = nextStatus;
    if (sample.sessionId) sessionIds.add(sample.sessionId);
  }

  for (const cluster of clusters) {
    if (cluster.id !== clusterId) continue;
    cluster.reason = reason;
    cluster.label = reason;
    cluster.status = reason === "false-positive" ? "false_positive" : "labeled";
  }

  for (const session of sessions) {
    if (!sessionIds.has(session.id)) continue;
    session.reason = reason;
    session.status = nextStatus;
  }

  saveJson(samplesPath, samples);
  saveJson(clustersPath, clusters);
  saveJson(sessionsPath, sessions);

  return getLocalTrainingState(petId || target.petId);
}

export function getLocalTrainingAudio(sampleId) {
  if (!existsSync(audioDir)) return null;
  const files = readdirSync(audioDir).filter((file) => file.startsWith(sampleId));
  const fileName = files[0];
  if (!fileName) return null;
  const path = resolve(audioDir, fileName);
  const body = readFileSync(path);
  const extension = extname(fileName).toLowerCase();
  const contentType =
    extension === ".m4a" ? "audio/mp4" :
    extension === ".ogg" ? "audio/ogg" :
    extension === ".wav" ? "audio/wav" :
    "audio/webm";
  return { body, contentType, size: body.byteLength };
}
