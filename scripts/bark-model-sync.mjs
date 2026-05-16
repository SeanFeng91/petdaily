import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BARK_MODEL_TYPE,
  buildBarkModelVector,
  getBarkModelLabel,
  trainBarkModel
} from "../lib/bark-model.js";

const root = process.cwd();
const syncDir = resolve(root, "data/bark-sync");
const audioDir = resolve(syncDir, "audio");
const mode = process.argv[2] || "sync";
const DEFAULT_TRAIN_EPOCHS = 120;
const DEFAULT_HIDDEN_UNITS = 36;
const reasonLabelMap = {
  outside: "想出去",
  food: "想吃",
  bored: "无聊",
  attention: "关注",
  fear: "警觉",
  false_positive: "不是狗叫"
};

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

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeObject(value) {
  const parsed = typeof value === "string" ? parseJson(value, {}) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function getReasonLabel(reason) {
  if (String(reason || "").startsWith("acoustic_")) {
    return `声纹组 ${String(reason).split("_")[1] || ""}`.trim();
  }
  return reasonLabelMap[reason] || reason || "未标注";
}

function getAudioExtension(sample) {
  const type = sample.audioContentType || "";
  if (type.includes("mp4")) return ".m4a";
  if (type.includes("ogg")) return ".ogg";
  if (type.includes("wav")) return ".wav";
  return extname(sample.audioObjectKey || "") || ".webm";
}

function hasCachedAudio(path) {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
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

function getVectorDimension(records) {
  return Math.max(0, ...records.map((record) => record.vector.length));
}

function vectorAt(vector, index) {
  return Number.isFinite(vector[index]) ? vector[index] : 0;
}

function softmax(scores) {
  const max = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - max));
  const sum = exps.reduce((total, value) => total + value, 0) || 1;
  return exps.map((value) => value / sum);
}

function evaluateLinearProbe(records, labels, weights, biases, dimension) {
  if (!records.length) return { accuracy: 0, loss: 0, correct: 0, total: 0, predictions: [] };
  let correct = 0;
  let loss = 0;
  const predictions = [];

  for (const record of records) {
    const scores = labels.map((_, labelIndex) => {
      let score = biases[labelIndex] || 0;
      for (let featureIndex = 0; featureIndex < dimension; featureIndex += 1) {
        score += (weights[labelIndex][featureIndex] || 0) * vectorAt(record.vector, featureIndex);
      }
      return score;
    });
    const probabilities = softmax(scores);
    const predictionIndex = probabilities.indexOf(Math.max(...probabilities));
    const targetIndex = labels.indexOf(record.label);
    const probability = clamp(probabilities[targetIndex], 1e-6, 1);
    loss += -Math.log(probability);
    if (predictionIndex === targetIndex) correct += 1;
    predictions.push({
      id: record.id,
      actual: record.label,
      predicted: labels[predictionIndex],
      confidence: Number((probabilities[predictionIndex] || 0).toFixed(4))
    });
  }

  return {
    accuracy: Number((correct / records.length).toFixed(4)),
    loss: Number((loss / records.length).toFixed(4)),
    correct,
    total: records.length,
    predictions
  };
}

function buildConfusionMatrix(labels, predictions) {
  return labels.map((actual) => ({
    actual,
    cells: labels.map((predicted) => ({
      predicted,
      count: predictions.filter((item) => item.actual === actual && item.predicted === predicted).length
    }))
  }));
}

function trainLinearProbe(samples, options = {}) {
  const records = samples
    .map((sample) => ({
      id: sample.id,
      label: getBarkModelLabel(sample),
      vector: buildBarkModelVector(sample)
    }))
    .filter((record) => record.label && record.vector.length);
  const labels = [...new Set(records.map((record) => record.label))].sort();

  if (records.length < 4 || labels.length < 2) {
    return {
      status: "blocked",
      reason: labels.length < 2 ? "至少需要 2 个不同标签，才能绘制有效训练曲线。" : "至少需要 4 条已标注样本，才能开始训练探针。",
      labels,
      epochs: [],
      confusionMatrix: []
    };
  }

  const dimension = getVectorDimension(records);
  const validationRecords = records.length >= 10 ? records.filter((_, index) => index % 5 === 0) : records;
  const trainingRecords = records.length >= 10 ? records.filter((_, index) => index % 5 !== 0) : records;
  const weights = labels.map((_, labelIndex) =>
    Array.from({ length: dimension }, (_, featureIndex) => ((labelIndex + 1) * ((featureIndex % 7) - 3)) / 10000)
  );
  const biases = labels.map(() => 0);
  const epochs = [];
  const epochCount = options.epochs || 48;

  for (let epoch = 1; epoch <= epochCount; epoch += 1) {
    const learningRate = 0.12 / Math.sqrt(epoch);
    for (const record of trainingRecords) {
      const scores = labels.map((_, labelIndex) => {
        let score = biases[labelIndex] || 0;
        for (let featureIndex = 0; featureIndex < dimension; featureIndex += 1) {
          score += (weights[labelIndex][featureIndex] || 0) * vectorAt(record.vector, featureIndex);
        }
        return score;
      });
      const probabilities = softmax(scores);
      const targetIndex = labels.indexOf(record.label);
      for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
        const error = probabilities[labelIndex] - (labelIndex === targetIndex ? 1 : 0);
        biases[labelIndex] -= learningRate * error;
        for (let featureIndex = 0; featureIndex < dimension; featureIndex += 1) {
          weights[labelIndex][featureIndex] -= learningRate * error * vectorAt(record.vector, featureIndex);
        }
      }
    }

    const trainEval = evaluateLinearProbe(trainingRecords, labels, weights, biases, dimension);
    const validationEval = evaluateLinearProbe(validationRecords, labels, weights, biases, dimension);
    epochs.push({
      epoch,
      loss: trainEval.loss,
      accuracy: trainEval.accuracy,
      validationLoss: validationEval.loss,
      validationAccuracy: validationEval.accuracy
    });
  }

  const finalEval = evaluateLinearProbe(validationRecords, labels, weights, biases, dimension);
  return {
    status: "trained",
    reason: "线性探针已完成，用于观察特征是否可被迭代训练分开。",
    labels,
    trainSampleCount: trainingRecords.length,
    validationSampleCount: validationRecords.length,
    epochs,
    confusionMatrix: buildConfusionMatrix(labels, finalEval.predictions)
  };
}

function inferWeakLabel(sample, cluster) {
  const manual = getBarkModelLabel(sample);
  if (manual) {
    return { label: manual, source: "manual", confidence: 1, reason: "人工标签" };
  }

  const clusterLabel = cluster?.reason || cluster?.label;
  if (clusterLabel && clusterLabel !== "candidate" && clusterLabel !== "unknown") {
    return { label: clusterLabel, source: "cluster", confidence: 0.82, reason: "沿用聚类标签" };
  }

  const features = normalizeObject(sample.features);
  const barkScore = Number(sample.barkScore || 0);
  const flatness = Number(features.spectralFlatness || 0);
  const highRatio = Number(features.highRatio || 0);
  const flux = Number(features.spectralFlux || 0);
  const relativeRms = Number(features.relativeRms || 0);
  const hour = Number(features.hour ?? new Date(sample.capturedAt || Date.now()).getHours());
  const sinceFood = Number(features.sinceFoodMinutes);
  const sincePotty = Number(features.sincePottyMinutes);
  const recentEventCount = Number(features.recentEventCount || 0);

  if (barkScore < 0.42 || (flatness > 0.7 && highRatio < 0.14 && flux < 0.08)) {
    return { label: "false_positive", source: "weak", confidence: 0.58, reason: "低分或稳定噪音特征" };
  }
  if (Number.isFinite(sinceFood) && sinceFood < 90) {
    return { label: "food", source: "weak", confidence: 0.62, reason: "接近进食上下文" };
  }
  if (Number.isFinite(sincePotty) && sincePotty > 240) {
    return { label: "outside", source: "weak", confidence: 0.6, reason: "距离上次外出/如厕较久" };
  }
  if (hour >= 22 || hour <= 6 || highRatio > 0.38 || flux > 0.28) {
    return { label: "fear", source: "weak", confidence: 0.56, reason: "夜间或尖锐突发声学形态" };
  }
  if (recentEventCount > 0 || relativeRms > 2.2) {
    return { label: "attention", source: "weak", confidence: 0.55, reason: "近期事件或响度突增" };
  }
  return { label: "bored", source: "weak", confidence: 0.52, reason: "缺少明确上下文，先归为无聊候选" };
}

function euclideanDistance(a, b) {
  let sum = 0;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    sum += (vectorAt(a, index) - vectorAt(b, index)) ** 2;
  }
  return Math.sqrt(sum);
}

function averageVectors(vectors) {
  const length = Math.max(0, ...vectors.map((vector) => vector.length));
  return Array.from({ length }, (_, index) => {
    const total = vectors.reduce((sum, vector) => sum + vectorAt(vector, index), 0);
    return Number((total / Math.max(1, vectors.length)).toFixed(6));
  });
}

function chooseInitialCentroids(records, count) {
  if (!records.length) return [];
  const centroids = [records[0].vector];
  while (centroids.length < count) {
    let best = records[centroids.length % records.length];
    let bestDistance = -1;
    for (const record of records) {
      const distance = Math.min(...centroids.map((centroid) => euclideanDistance(record.vector, centroid)));
      if (distance > bestDistance) {
        bestDistance = distance;
        best = record;
      }
    }
    centroids.push(best.vector);
  }
  return centroids.map((centroid) => [...centroid]);
}

function assignAcousticClusters(samples) {
  const records = samples
    .map((sample) => ({ sample, vector: buildBarkModelVector(sample) }))
    .filter((record) => record.vector.length);
  if (!records.length) return new Map();

  const standardized = standardizeRecords(records.map((record) => ({
    id: record.sample.id,
    label: "candidate",
    vector: record.vector
  })));
  const normalizedRecords = records.map((record, index) => ({
    ...record,
    vector: standardized.records[index]?.vector || record.vector
  }));
  const clusterCount = Math.max(2, Math.min(6, Math.round(Math.sqrt(records.length / 8))));
  let centroids = chooseInitialCentroids(normalizedRecords, clusterCount);
  const assignments = new Map();

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const buckets = Array.from({ length: clusterCount }, () => []);
    for (const record of normalizedRecords) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < centroids.length; index += 1) {
        const distance = euclideanDistance(record.vector, centroids[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      assignments.set(record.sample.id, { index: bestIndex, distance: bestDistance });
      buckets[bestIndex].push(record.vector);
    }
    centroids = buckets.map((vectors, index) => vectors.length ? averageVectors(vectors) : centroids[index]);
  }

  const distances = [...assignments.values()].map((item) => item.distance);
  const maxDistance = Math.max(0.001, ...distances);
  const result = new Map();
  for (const record of normalizedRecords) {
    const assignment = assignments.get(record.sample.id);
    const confidence = Number((1 - clamp(assignment.distance / maxDistance, 0, 0.82)).toFixed(4));
    result.set(record.sample.id, {
      label: `acoustic_${assignment.index + 1}`,
      confidence,
      reason: `按声纹 embedding 聚类为第 ${assignment.index + 1} 组`
    });
  }
  return result;
}

function buildTrainingSamples(samples, clusters) {
  const clustersById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const acousticAssignments = assignAcousticClusters(samples);
  const firstPass = samples.map((sample) => ({
    sample,
    inferred: inferWeakLabel(sample, clustersById.get(sample.clusterId)),
    acoustic: acousticAssignments.get(sample.id)
  }));
  const clusterVotes = new Map();

  for (const item of firstPass) {
    const clusterId = item.sample.clusterId;
    if (!clusterId) continue;
    if (!clusterVotes.has(clusterId)) clusterVotes.set(clusterId, new Map());
    const votes = clusterVotes.get(clusterId);
    const weight = item.inferred.source === "manual" ? 4 : item.inferred.confidence;
    votes.set(item.inferred.label, (votes.get(item.inferred.label) || 0) + weight);
  }

  const clusterLabels = new Map();
  for (const [clusterId, votes] of clusterVotes.entries()) {
    const [label] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (label) clusterLabels.set(clusterId, label);
  }

  return firstPass.map(({ sample, inferred, acoustic }) => {
    const hasManualLabel = inferred.source === "manual";
    const clusterLabel = sample.clusterId ? clusterLabels.get(sample.clusterId) : null;
    const finalLabel = hasManualLabel ? inferred.label : acoustic?.label || clusterLabel || inferred.label;
    return {
      ...sample,
      status: hasManualLabel && sample.status ? sample.status : "auto_labeled",
      reason: finalLabel,
      localLabelSource: hasManualLabel ? "manual" : "acoustic",
      localLabelConfidence: hasManualLabel ? inferred.confidence : acoustic?.confidence || inferred.confidence,
      localLabelReason: hasManualLabel ? inferred.reason : acoustic?.reason || inferred.reason,
      localSemanticSuggestion: inferred.label,
      localSemanticSuggestionText: getReasonLabel(inferred.label),
      localSemanticSuggestionReason: inferred.reason,
      localOriginalReason: sample.reason || null
    };
  });
}

function createSeededRandom(seedText) {
  let seed = 2166136261;
  for (const char of String(seedText)) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function splitRecords(records) {
  if (records.length < 12) return { train: records, validation: records };
  const byLabel = new Map();
  for (const record of records) {
    if (!byLabel.has(record.label)) byLabel.set(record.label, []);
    byLabel.get(record.label).push(record);
  }
  const train = [];
  const validation = [];
  for (const group of byLabel.values()) {
    const validationEvery = group.length >= 5 ? 5 : Math.max(2, group.length);
    group.forEach((record, index) => {
      if (index % validationEvery === 0) validation.push(record);
      else train.push(record);
    });
  }
  return { train, validation };
}

function standardizeRecords(records) {
  const dimension = getVectorDimension(records);
  const means = Array.from({ length: dimension }, (_, index) =>
    records.reduce((sum, record) => sum + vectorAt(record.vector, index), 0) / Math.max(1, records.length)
  );
  const scales = means.map((mean, index) => {
    const variance = records.reduce((sum, record) => sum + (vectorAt(record.vector, index) - mean) ** 2, 0) / Math.max(1, records.length);
    return Math.sqrt(variance) || 1;
  });
  return {
    dimension,
    means,
    scales,
    records: records.map((record) => ({
      ...record,
      vector: Array.from({ length: dimension }, (_, index) => (vectorAt(record.vector, index) - means[index]) / scales[index])
    }))
  };
}

function evaluateMlp(records, labels, model) {
  if (!records.length) return { accuracy: 0, loss: 0, predictions: [] };
  let correct = 0;
  let loss = 0;
  const predictions = [];

  for (const record of records) {
    const hidden = model.w1.map((row, hiddenIndex) => {
      let sum = model.b1[hiddenIndex] || 0;
      for (let featureIndex = 0; featureIndex < model.dimension; featureIndex += 1) {
        sum += (row[featureIndex] || 0) * vectorAt(record.vector, featureIndex);
      }
      return Math.tanh(sum);
    });
    const scores = labels.map((_, labelIndex) => {
      let sum = model.b2[labelIndex] || 0;
      for (let hiddenIndex = 0; hiddenIndex < model.hiddenUnits; hiddenIndex += 1) {
        sum += (model.w2[labelIndex][hiddenIndex] || 0) * hidden[hiddenIndex];
      }
      return sum;
    });
    const probabilities = softmax(scores);
    const targetIndex = labels.indexOf(record.label);
    const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
    loss += -Math.log(clamp(probabilities[targetIndex], 1e-6, 1));
    if (predictedIndex === targetIndex) correct += 1;
    predictions.push({
      id: record.id,
      actual: record.label,
      predicted: labels[predictedIndex],
      confidence: Number((probabilities[predictedIndex] || 0).toFixed(4))
    });
  }

  return {
    accuracy: Number((correct / records.length).toFixed(4)),
    loss: Number((loss / records.length).toFixed(4)),
    predictions
  };
}

function trainDeepLocalModel(samples, options = {}) {
  const records = samples
    .map((sample) => ({
      id: sample.id,
      label: getBarkModelLabel(sample),
      vector: buildBarkModelVector(sample),
      source: sample.localLabelSource || "manual"
    }))
    .filter((record) => record.label && record.vector.length);
  const labels = [...new Set(records.map((record) => record.label))].sort();

  if (records.length < 8 || labels.length < 2) {
    return {
      status: "blocked",
      reason: "深度本地训练至少需要 8 条样本和 2 个标签。",
      labels,
      epochs: [],
      confusionMatrix: []
    };
  }

  const epochCount = Number(process.env.BARK_TRAIN_EPOCHS || options.epochs || DEFAULT_TRAIN_EPOCHS);
  const hiddenUnits = Number(process.env.BARK_TRAIN_HIDDEN || options.hiddenUnits || DEFAULT_HIDDEN_UNITS);
  const standardized = standardizeRecords(records);
  const { train: trainRecords, validation: validationRecords } = splitRecords(standardized.records);
  const random = createSeededRandom(`${options.version}-${records.length}-${labels.join(",")}`);
  const model = {
    type: "local-mlp-v1",
    version: options.version,
    inputDimension: standardized.dimension,
    dimension: standardized.dimension,
    hiddenUnits,
    labels,
    means: standardized.means.map((value) => Number(value.toFixed(5))),
    scales: standardized.scales.map((value) => Number(value.toFixed(5))),
    w1: Array.from({ length: hiddenUnits }, () =>
      Array.from({ length: standardized.dimension }, () => Number(((random() - 0.5) * 0.16).toFixed(6)))
    ),
    b1: Array.from({ length: hiddenUnits }, () => 0),
    w2: labels.map(() => Array.from({ length: hiddenUnits }, () => Number(((random() - 0.5) * 0.12).toFixed(6)))),
    b2: labels.map(() => 0)
  };
  const epochs = [];
  const patience = Number(process.env.BARK_TRAIN_PATIENCE || 18);
  const minEpochs = Math.min(epochCount, Number(process.env.BARK_TRAIN_MIN_EPOCHS || 40));
  let bestValidationLoss = Infinity;
  let staleEpochs = 0;

  for (let epoch = 1; epoch <= epochCount; epoch += 1) {
    const learningRate = 0.045 / Math.sqrt(1 + epoch * 0.03);
    for (const record of trainRecords) {
      const hiddenRaw = model.w1.map((row, hiddenIndex) => {
        let sum = model.b1[hiddenIndex] || 0;
        for (let featureIndex = 0; featureIndex < model.dimension; featureIndex += 1) {
          sum += (row[featureIndex] || 0) * vectorAt(record.vector, featureIndex);
        }
        return sum;
      });
      const hidden = hiddenRaw.map(Math.tanh);
      const scores = labels.map((_, labelIndex) => {
        let sum = model.b2[labelIndex] || 0;
        for (let hiddenIndex = 0; hiddenIndex < hiddenUnits; hiddenIndex += 1) {
          sum += (model.w2[labelIndex][hiddenIndex] || 0) * hidden[hiddenIndex];
        }
        return sum;
      });
      const probabilities = softmax(scores);
      const targetIndex = labels.indexOf(record.label);
      const outputErrors = probabilities.map((probability, index) => probability - (index === targetIndex ? 1 : 0));

      for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
        model.b2[labelIndex] -= learningRate * outputErrors[labelIndex];
        for (let hiddenIndex = 0; hiddenIndex < hiddenUnits; hiddenIndex += 1) {
          model.w2[labelIndex][hiddenIndex] -= learningRate * outputErrors[labelIndex] * hidden[hiddenIndex];
        }
      }

      for (let hiddenIndex = 0; hiddenIndex < hiddenUnits; hiddenIndex += 1) {
        const downstream = labels.reduce((sum, _, labelIndex) => sum + outputErrors[labelIndex] * (model.w2[labelIndex][hiddenIndex] || 0), 0);
        const hiddenError = downstream * (1 - hidden[hiddenIndex] ** 2);
        model.b1[hiddenIndex] -= learningRate * hiddenError;
        for (let featureIndex = 0; featureIndex < model.dimension; featureIndex += 1) {
          model.w1[hiddenIndex][featureIndex] -= learningRate * hiddenError * vectorAt(record.vector, featureIndex);
        }
      }
    }

    const trainEval = evaluateMlp(trainRecords, labels, model);
    const validationEval = evaluateMlp(validationRecords, labels, model);
    epochs.push({
      epoch,
      loss: trainEval.loss,
      accuracy: trainEval.accuracy,
      validationLoss: validationEval.loss,
      validationAccuracy: validationEval.accuracy
    });

    if (validationEval.loss < bestValidationLoss - 0.0005) {
      bestValidationLoss = validationEval.loss;
      staleEpochs = 0;
    } else {
      staleEpochs += 1;
    }
    if (epoch >= minEpochs && staleEpochs >= patience) break;
  }

  const finalEval = evaluateMlp(validationRecords, labels, model);
  return {
    status: "trained",
    reason: "本地 MLP 训练完成，只作为离线研究模型和人工校准依据。",
    labels,
    labelNames: Object.fromEntries(labels.map((label) => [label, getReasonLabel(label)])),
    trainSampleCount: trainRecords.length,
    validationSampleCount: validationRecords.length,
    hiddenUnits,
    epochCount: epochs.length,
    requestedEpochCount: epochCount,
    earlyStopped: epochs.length < epochCount,
    epochs,
    confusionMatrix: buildConfusionMatrix(labels, finalEval.predictions),
    model: {
      ...model,
      w1: model.w1.map((row) => row.map((value) => Number(value.toFixed(6)))),
      b1: model.b1.map((value) => Number(value.toFixed(6))),
      w2: model.w2.map((row) => row.map((value) => Number(value.toFixed(6)))),
      b2: model.b2.map((value) => Number(value.toFixed(6)))
    }
  };
}

function buildTrainingReport({ petId, rawSamples, trainingSamples, model, metrics, productionMetrics, version, deepTraining }) {
  const labelCounts = new Map();
  const sourceCounts = new Map();
  for (const sample of trainingSamples) {
    const label = getBarkModelLabel(sample) || "unlabeled";
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    sourceCounts.set(sample.localLabelSource || "manual", (sourceCounts.get(sample.localLabelSource || "manual") || 0) + 1);
  }
  const linearProbe = trainLinearProbe(trainingSamples, { epochs: 64 });
  const manualCount = rawSamples.filter((sample) => getBarkModelLabel(sample)).length;
  const pseudoCount = trainingSamples.filter((sample) => sample.localLabelSource !== "manual").length;
  const blockedReason =
    metrics.labeledSampleCount <= 0 && pseudoCount <= 0
      ? "这批数据还没有人工标签，也无法生成候选标签。"
    : metrics.classCount < 2
        ? "当前只有一个标签类型，无法验证分类边界。"
        : "";

  return {
    petId,
    version,
    generatedAt: new Date().toISOString(),
    productionModelType: BARK_MODEL_TYPE,
    deepLearningEnabled: deepTraining.status === "trained",
    status: blockedReason ? "blocked" : "trained",
    blockedReason,
    summary: {
      sampleCount: rawSamples.length,
      trainingSampleCount: trainingSamples.length,
      manualLabelCount: manualCount,
      pseudoLabelCount: pseudoCount,
      labeledSampleCount: metrics.labeledSampleCount,
      unlabeledSampleCount: Math.max(0, rawSamples.length - manualCount),
      classCount: metrics.classCount,
      prototypeCount: model.prototypes.length,
      productionPrototypeCount: productionMetrics?.classCount || 0,
      productionManualSampleCount: productionMetrics?.labeledSampleCount || 0,
      evaluatedSampleCount: metrics.evaluatedSampleCount,
      trainingAccuracy: metrics.trainingAccuracy,
      hiddenUnits: deepTraining.hiddenUnits || 0,
      epochCount: deepTraining.epochCount || 0
    },
    labelCounts: [...labelCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    stages: [
      { key: "download", label: "数据同步", status: rawSamples.length ? "done" : "blocked", detail: `${rawSamples.length} 条样本` },
      { key: "label", label: "候选标签", status: trainingSamples.length ? "done" : "blocked", detail: `${manualCount} 人工 / ${pseudoCount} 自动` },
      { key: "feature", label: "特征向量", status: rawSamples.some((sample) => buildBarkModelVector(sample).length) ? "done" : "blocked", detail: "声纹 embedding + 声学特征" },
      { key: "prototype", label: "本地原型", status: model.prototypes.length ? "done" : "blocked", detail: `${model.prototypes.length} 个 prototype` },
      { key: "production", label: "生产可推", status: productionMetrics?.classCount ? "done" : "blocked", detail: `${productionMetrics?.labeledSampleCount || 0} 人工样本` },
      { key: "probe", label: "线性探针", status: linearProbe.status === "trained" ? "done" : "blocked", detail: linearProbe.reason },
      { key: "deep", label: "本地 MLP", status: deepTraining.status === "trained" ? "done" : "blocked", detail: deepTraining.reason }
    ],
    sourceCounts: [...sourceCounts.entries()].map(([source, count]) => ({ source, count })),
    pseudoLabels: trainingSamples
      .filter((sample) => sample.localLabelSource !== "manual")
      .slice(0, 30)
      .map((sample) => ({
        id: sample.id,
        label: sample.reason,
        labelText: getReasonLabel(sample.reason),
        source: sample.localLabelSource,
        confidence: sample.localLabelConfidence,
        reason: sample.localLabelReason,
        semanticSuggestion: sample.localSemanticSuggestion,
        semanticSuggestionText: sample.localSemanticSuggestionText,
        semanticSuggestionReason: sample.localSemanticSuggestionReason,
        capturedAt: sample.capturedAt,
        barkScore: sample.barkScore,
        localAudioUrl: `/api/bark/training/local/audio/${encodeURIComponent(sample.id)}`
      })),
    linearProbe,
    deepTraining: {
      ...deepTraining,
      model: undefined
    }
  };
}

function download() {
  assertNodeVersion();
  mkdirSync(audioDir, { recursive: true });
  const forceAudioDownload = process.env.BARK_SYNC_FORCE_AUDIO === "1";
  const pets = queryTable("PetProfile");
  const samples = queryTable("BarkSample");
  const sessions = queryTable("BarkSession");
  const clusters = queryTable("BarkCluster");

  saveJson(resolve(syncDir, "pets.json"), pets);
  saveJson(resolve(syncDir, "samples.json"), samples);
  saveJson(resolve(syncDir, "sessions.json"), sessions);
  saveJson(resolve(syncDir, "clusters.json"), clusters);

  const audioManifest = [];
  let cachedAudioCount = 0;
  let downloadedAudioCount = 0;
  let missingAudioCount = 0;

  for (const sample of samples) {
    if (!sample.audioObjectKey) continue;
    const dest = resolve(audioDir, `${sample.id}${getAudioExtension(sample)}`);

    if (!forceAudioDownload && hasCachedAudio(dest)) {
      cachedAudioCount += 1;
      audioManifest.push({
        sampleId: sample.id,
        audioObjectKey: sample.audioObjectKey,
        path: dest,
        status: "downloaded",
        source: "cache"
      });
      continue;
    }

    try {
      runWrangler(["r2", "object", "get", `petdaily-bark-audio/${sample.audioObjectKey}`, "--remote", "--file", dest]);
      downloadedAudioCount += 1;
      audioManifest.push({
        sampleId: sample.id,
        audioObjectKey: sample.audioObjectKey,
        path: dest,
        status: "downloaded",
        source: "remote"
      });
    } catch (error) {
      missingAudioCount += 1;
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
  console.log(
    `Synced ${samples.length} bark samples, ${sessions.length} sessions, ${clusters.length} clusters. ` +
    `Audio: ${downloadedAudioCount} downloaded, ${cachedAudioCount} cached, ${missingAudioCount} missing.`
  );
}

function train() {
  const samples = readJson(resolve(syncDir, "samples.json"));
  const pets = readJson(resolve(syncDir, "pets.json"));
  const petIds = [...new Set(samples.map((sample) => sample.petId).filter(Boolean))];
  const targetPetIds = petIds.length ? petIds : pets.map((pet) => pet.id).filter(Boolean);
  const artifacts = [];
  const reports = [];

  for (const petId of targetPetIds) {
    const petSamples = samples.filter((sample) => sample.petId === petId);
    const version = `bark-local-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${petId.slice(-6)}`;
    const petClusters = readJson(resolve(syncDir, "clusters.json"), []).filter((cluster) => cluster.petId === petId);
    const trainingSamples = buildTrainingSamples(petSamples, petClusters);
    const productionTraining = trainBarkModel(petSamples, { petId, version });
    const localPrototypeTraining = trainBarkModel(trainingSamples, { petId, version });
    const deepTraining = trainDeepLocalModel(trainingSamples, { version });
    saveJson(resolve(syncDir, `deep-model-${petId}.json`), {
      petId,
      version,
      generatedAt: new Date().toISOString(),
      model: deepTraining.model || null
    });
    reports.push(buildTrainingReport({
      petId,
      rawSamples: petSamples,
      trainingSamples,
      model: localPrototypeTraining.model,
      metrics: localPrototypeTraining.metrics,
      productionMetrics: productionTraining.metrics,
      version,
      deepTraining
    }));
    artifacts.push({
      id: `bark_model_${randomUUID()}`,
      petId,
      version,
      modelType: BARK_MODEL_TYPE,
      artifact: productionTraining.model,
      metrics: productionTraining.metrics,
      status: "active",
      trainedAt: productionTraining.model.trainedAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  saveJson(resolve(syncDir, "model-artifacts.json"), artifacts);
  saveJson(resolve(syncDir, "training-report.json"), {
    generatedAt: new Date().toISOString(),
    reports
  });
  const labeledCount = reports.reduce((sum, report) => sum + report.summary.labeledSampleCount, 0);
  const blockedCount = reports.filter((report) => report.status === "blocked").length;
  console.log(`Trained ${artifacts.length} model artifact(s). Labeled samples: ${labeledCount}. Blocked reports: ${blockedCount}.`);
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
