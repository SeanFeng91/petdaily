import assert from "node:assert/strict";

import {
  BARK_SESSION_CONFIG,
  buildBarkEmbedding,
  getBarkFrameDecision,
  getBarkSessionCapturePlan,
  getInitialBarkSessionState
} from "../lib/bark-analysis.js";

const humanVoice = {
  rms: 0.05,
  peak: 0.18,
  relativeRms: 2.5,
  centroid: 0.26,
  highRatio: 0.22,
  spectralFlux: 0.025,
  spectralCrest: 0.18,
  spectralFlatness: 0.34,
  zcr: 0.12
};

const shortBark = {
  rms: 0.16,
  peak: 0.62,
  relativeRms: 4.8,
  centroid: 0.48,
  highRatio: 0.52,
  spectralFlux: 0.13,
  spectralCrest: 0.42,
  spectralFlatness: 0.12,
  zcr: 0.22
};

assert.equal(getBarkFrameDecision(humanVoice, "low", 0.02).accepted, false, "human-like voice should be rejected");
assert.equal(getBarkFrameDecision(humanVoice, "low", 0.02).speechLike, true, "human-like voice should be classified as speech-like");
assert.equal(getBarkFrameDecision(shortBark, "low", 0.02).accepted, true, "short sharp bark should be accepted");

let state = getInitialBarkSessionState();
const first = getBarkSessionCapturePlan(state, 1000, BARK_SESSION_CONFIG);
assert.equal(first.shouldSave, true, "first bark in a session should save a representative clip");
state = first.nextState;

const merged = getBarkSessionCapturePlan(state, 5000, BARK_SESSION_CONFIG);
assert.equal(merged.shouldSave, false, "bark inside min clip gap should merge into the current session");
assert.equal(merged.reason, "merged_gap");

const secondClip = getBarkSessionCapturePlan(merged.nextState, 14000, BARK_SESSION_CONFIG);
assert.equal(secondClip.shouldSave, true, "bark after min clip gap should save the next representative clip");
assert.equal(secondClip.barkCountIncrement, 2, "merged bark count should be carried into the next saved clip");

const morning = buildBarkEmbedding({ ...shortBark, hour: 8, sinceFoodMinutes: 5 });
const night = buildBarkEmbedding({ ...shortBark, hour: 22, sinceFoodMinutes: 240 });
assert.deepEqual(morning, night, "acoustic embedding should not change with time context");

console.log("bark-analysis smoke checks passed");
