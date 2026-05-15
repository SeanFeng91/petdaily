import assert from "node:assert/strict";
import { predictBarkModel, trainBarkModel } from "../lib/bark-model.js";

const baseBark = {
  petId: "pet_1",
  status: "confirmed",
  reason: "outside",
  barkScore: 0.86,
  embedding: [0.5, 0.76, 0.4, 0.45, 0.52, 0.66, 0.4, 0.28, 0.82, 0.32, 0.7, 0.58],
  features: {
    rms: 0.13,
    peak: 0.42,
    relativeRms: 3.1,
    centroid: 0.42,
    highRatio: 0.52,
    spectralFlux: 0.12,
    spectralCrest: 0.38,
    zcr: 0.14,
    spectralFlatness: 0.12
  }
};

const foodBark = {
  ...baseBark,
  reason: "food",
  embedding: [0.2, 0.32, 0.22, 0.25, 0.18, 0.28, 0.2, 0.18, 0.7, 0.16, 0.3, 0.36],
  features: {
    ...baseBark.features,
    rms: 0.06,
    peak: 0.16,
    relativeRms: 1.8,
    centroid: 0.24,
    highRatio: 0.2,
    spectralFlux: 0.045,
    spectralCrest: 0.18
  }
};

const falsePositive = {
  ...foodBark,
  status: "false_positive",
  reason: "false-positive",
  embedding: [0.08, 0.1, 0.1, 0.1, 0.08, 0.06, 0.08, 0.12, 0.28, 0.05, 0.08, 0.14],
  barkScore: 0.32
};

const unknown = {
  ...baseBark,
  status: "candidate",
  reason: null
};

const samples = [
  baseBark,
  { ...baseBark, embedding: baseBark.embedding.map((value) => Number((value + 0.02).toFixed(3))) },
  foodBark,
  { ...foodBark, embedding: foodBark.embedding.map((value) => Number((value + 0.015).toFixed(3))) },
  falsePositive,
  unknown
];

const { model, metrics } = trainBarkModel(samples, { petId: "pet_1", version: "test-model" });

assert.equal(model.prototypes.length, 3, "confirmed labels and false positives should become model classes");
assert.equal(metrics.labeledSampleCount, 5, "unknown candidate samples should not train the classifier");
assert.equal(predictBarkModel(model, baseBark).label, "outside", "outside-like bark should predict outside");
assert.equal(predictBarkModel(model, foodBark).label, "food", "food-like bark should predict food");
assert.equal(predictBarkModel(model, falsePositive).label, "false_positive", "false positive texture should stay separated");

const empty = trainBarkModel([unknown], { petId: "pet_1", version: "empty" });
assert.equal(empty.model.prototypes.length, 0, "unlabeled-only datasets should produce an empty model");
assert.equal(predictBarkModel(empty.model, unknown), null, "empty models should not predict");

console.log("bark-model smoke checks passed");
