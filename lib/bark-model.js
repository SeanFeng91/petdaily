export const BARK_MODEL_TYPE = "nearest-centroid-v1";

const MODEL_FEATURE_KEYS = [
  ["rms", 4],
  ["peak", 3],
  ["relativeRms", 0.2],
  ["centroid", 1],
  ["highRatio", 1],
  ["spectralFlux", 5],
  ["spectralCrest", 1],
  ["zcr", 2],
  ["spectralFlatness", 1],
  ["barkScore", 1]
];

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function normalizeArray(value, limit = 64) {
  const source = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, limit);
}

function normalizeFeatures(value) {
  const parsed = typeof value === "string" ? parseJson(value, {}) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
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

function averageVectors(vectors) {
  const length = Math.max(0, ...vectors.map((vector) => vector.length));
  const centroid = Array.from({ length }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < length; index += 1) {
      centroid[index] += vector[index] || 0;
    }
  }
  return centroid.map((value) => Number((value / Math.max(1, vectors.length)).toFixed(5)));
}

export function getBarkModelLabel(sample = {}) {
  if (sample.status === "false_positive" || sample.reason === "false-positive" || sample.reason === "false_positive") {
    return "false_positive";
  }
  if (sample.reason && sample.reason !== "unknown") return sample.reason;
  return null;
}

export function buildBarkModelVector(sample = {}) {
  const features = normalizeFeatures(sample.features);
  const embedding = normalizeArray(sample.embedding, 48);
  const featureValues = MODEL_FEATURE_KEYS.map(([key, scale]) => {
    const sourceValue = key === "barkScore" ? sample.barkScore : features[key];
    return Number(clamp(finiteNumber(sourceValue) * scale).toFixed(5));
  });
  return [...embedding, ...featureValues];
}

export function trainBarkModel(samples = [], options = {}) {
  const petId = options.petId || samples.find((sample) => sample?.petId)?.petId || null;
  const version = options.version || `bark-local-${Date.now()}`;
  const byLabel = new Map();

  for (const sample of samples) {
    const label = getBarkModelLabel(sample);
    if (!label) continue;
    const vector = buildBarkModelVector(sample);
    if (!vector.length) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(vector);
  }

  const prototypes = [...byLabel.entries()]
    .map(([label, vectors]) => {
      const centroid = averageVectors(vectors);
      const similarities = vectors.map((vector) => cosineSimilarity(vector, centroid));
      const averageSimilarity =
        similarities.reduce((sum, similarity) => sum + similarity, 0) / Math.max(1, similarities.length);
      return {
        label,
        sampleCount: vectors.length,
        centroid,
        averageSimilarity: Number(averageSimilarity.toFixed(5))
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount || a.label.localeCompare(b.label));

  const model = {
    type: BARK_MODEL_TYPE,
    version,
    petId,
    trainedAt: new Date().toISOString(),
    minConfidence: 0.55,
    minSimilarity: 0.72,
    prototypes
  };

  let correct = 0;
  let evaluated = 0;
  for (const sample of samples) {
    const label = getBarkModelLabel(sample);
    if (!label) continue;
    const prediction = predictBarkModel(model, sample, { allowLowConfidence: true });
    if (!prediction) continue;
    evaluated += 1;
    if (prediction.label === label) correct += 1;
  }

  const metrics = {
    sampleCount: samples.length,
    labeledSampleCount: [...byLabel.values()].reduce((sum, vectors) => sum + vectors.length, 0),
    classCount: prototypes.length,
    trainingAccuracy: evaluated ? Number((correct / evaluated).toFixed(4)) : 0,
    evaluatedSampleCount: evaluated
  };

  return { model, metrics };
}

export function predictBarkModel(model, sample = {}, options = {}) {
  const prototypes = Array.isArray(model?.prototypes) ? model.prototypes : [];
  if (!prototypes.length) return null;
  const vector = buildBarkModelVector(sample);
  if (!vector.length) return null;

  const ranked = prototypes
    .map((prototype) => ({
      label: prototype.label,
      sampleCount: prototype.sampleCount || 0,
      similarity: cosineSimilarity(vector, prototype.centroid || [])
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const best = ranked[0];
  const second = ranked[1];
  const margin = best.similarity - (second?.similarity || 0);
  const confidence = clamp((best.similarity + 1) / 2 * 0.74 + clamp(margin, 0, 1) * 0.26);
  const minSimilarity = finiteNumber(model.minSimilarity, 0.72);
  const minConfidence = finiteNumber(model.minConfidence, 0.55);

  if (!options.allowLowConfidence && (best.similarity < minSimilarity || confidence < minConfidence)) {
    return null;
  }

  return {
    label: best.label,
    confidence: Number(confidence.toFixed(4)),
    similarity: Number(best.similarity.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    version: model.version || null,
    modelType: model.type || BARK_MODEL_TYPE
  };
}
