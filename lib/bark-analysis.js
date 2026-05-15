export const BARK_DETECTOR_VERSION = "bark-front-v3";

export const BARK_SESSION_CONFIG = {
  sessionGapMs: 30000,
  minClipGapMs: 12000,
  maxClipsPerSession: 6
};

export const BARK_SENSITIVITY_CONFIG = {
  low: {
    label: "降误报",
    minScore: 0.72,
    activeFrames: 7,
    cooldownMs: 12000,
    relativeRms: 2.35,
    flux: 0.09,
    peakMultiplier: 3.4,
    minCrest: 0.32
  },
  medium: {
    label: "均衡",
    minScore: 0.6,
    activeFrames: 5,
    cooldownMs: 9000,
    relativeRms: 1.85,
    flux: 0.065,
    peakMultiplier: 2.75,
    minCrest: 0.26
  },
  high: {
    label: "多收集",
    minScore: 0.48,
    activeFrames: 4,
    cooldownMs: 7000,
    relativeRms: 1.55,
    flux: 0.045,
    peakMultiplier: 2.2,
    minCrest: 0.2
  }
};

export function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function buildBarkEmbedding(features) {
  return [
    clamp(features.rms * 4),
    clamp(features.peak * 3),
    clamp(features.relativeRms / 5),
    clamp(features.centroid),
    clamp(features.highRatio),
    clamp(features.spectralFlux * 5),
    clamp(features.spectralCrest),
    clamp(features.zcr * 2),
    clamp(1 - features.spectralFlatness),
    clamp((features.peak - features.rms) * 4),
    clamp((features.highRatio || 0) + (features.spectralFlux || 0) * 2),
    clamp((features.spectralCrest || 0) + (1 - (features.spectralFlatness || 0)) * 0.3)
  ].map((item) => Number(item.toFixed(5)));
}

export function scoreBarkFeatures(features) {
  return clamp(
    (features.relativeRms - 1.05) * 0.2 +
      features.peak * 0.18 +
      features.spectralFlux * 1.8 +
      features.spectralCrest * 0.14 +
      features.highRatio * 0.12 +
      features.zcr * 0.16 -
      features.spectralFlatness * 0.08
  );
}

export function isLikelyBarkBurst(features, sensitivity, noiseBaseline) {
  const config = BARK_SENSITIVITY_CONFIG[sensitivity] || BARK_SENSITIVITY_CONFIG.high;
  const score = scoreBarkFeatures(features);
  return (
    score >= config.minScore &&
    (features.relativeRms >= config.relativeRms ||
      features.spectralFlux >= config.flux ||
      features.peak >= noiseBaseline * config.peakMultiplier)
  );
}

export function getBarkAcousticProfile(features = {}) {
  const highRatio = Number(features.highRatio || 0);
  const flux = Number(features.spectralFlux || 0);
  const crest = Number(features.spectralCrest || 0);
  const peak = Number(features.peak || 0);
  const rms = Number(features.rms || 0);
  const centroid = Number(features.centroid || 0);
  const flatness = Number(features.spectralFlatness || 0);

  const pitch = highRatio >= 0.46 || centroid >= 0.42 ? "high" : highRatio <= 0.24 && centroid <= 0.24 ? "low" : "mid";
  const energy = peak >= 0.46 || rms >= 0.12 ? "strong" : peak <= 0.22 && rms <= 0.055 ? "soft" : "medium";
  const burst = flux >= 0.09 || crest >= 0.36 ? "sharp" : flux <= 0.04 && crest <= 0.2 ? "steady" : "mixed";
  const texture = flatness >= 0.38 ? "noisy" : flatness <= 0.14 ? "tonal" : "balanced";

  const labels = {
    pitch: pitch === "high" ? "高亢" : pitch === "low" ? "低沉" : "中频",
    energy: energy === "strong" ? "强" : energy === "soft" ? "弱" : "中等",
    burst: burst === "sharp" ? "短促尖锐" : burst === "steady" ? "持续平稳" : "起伏混合",
    texture: texture === "noisy" ? "粗糙" : texture === "tonal" ? "清亮" : "均衡"
  };

  return {
    pitch,
    energy,
    burst,
    texture,
    key: `${pitch}-${energy}-${burst}-${texture}`,
    label: `${labels.energy}${labels.pitch} · ${labels.burst}`
  };
}

export function isLikelyHumanVoiceFrame(features = {}) {
  const rms = Number(features.rms || 0);
  const highRatio = Number(features.highRatio || 0);
  const flux = Number(features.spectralFlux || 0);
  const crest = Number(features.spectralCrest || 0);
  const flatness = Number(features.spectralFlatness || 0);
  const zcr = Number(features.zcr || 0);
  const peak = Number(features.peak || 0);

  const steadyMidBand = rms >= 0.018 && highRatio < 0.34 && flux < 0.052 && crest < 0.28;
  const voicedTexture = flatness >= 0.18 && flatness <= 0.62 && zcr >= 0.025 && zcr <= 0.42;
  const lacksBarkAttack = peak < 0.42 && flux < 0.06;
  return steadyMidBand && voicedTexture && lacksBarkAttack;
}

export function getBarkFrameDecision(features = {}, sensitivity = "low", noiseBaseline = 0.025) {
  const config = BARK_SENSITIVITY_CONFIG[sensitivity] || BARK_SENSITIVITY_CONFIG.low;
  const score = scoreBarkFeatures(features);
  const speechLike = isLikelyHumanVoiceFrame(features);
  const attack =
    features.spectralFlux >= config.flux ||
    features.spectralCrest >= config.minCrest ||
    features.peak >= Math.max(noiseBaseline * config.peakMultiplier, features.rms * 2.1);
  const loudEnough = features.relativeRms >= config.relativeRms || features.peak >= noiseBaseline * config.peakMultiplier;
  const accepted = score >= config.minScore && loudEnough && attack && !speechLike;

  return {
    score,
    accepted,
    speechLike,
    reason: accepted ? "bark" : speechLike ? "human_voice" : attack ? "below_threshold" : "steady_noise"
  };
}

export function getInitialBarkSessionState() {
  return {
    startedAt: null,
    lastAcceptedAt: 0,
    lastSavedAt: 0,
    savedClips: 0,
    pendingBarkCount: 0
  };
}

export function getBarkSessionCapturePlan(state = getInitialBarkSessionState(), now = Date.now(), config = BARK_SESSION_CONFIG) {
  const active = state.startedAt && now - state.lastAcceptedAt <= config.sessionGapMs;
  const base = active
    ? state
    : {
        ...getInitialBarkSessionState(),
        startedAt: now
      };
  const pendingBarkCount = (base.pendingBarkCount || 0) + 1;
  const hasClipGap = !base.lastSavedAt || now - base.lastSavedAt >= config.minClipGapMs;
  const hasClipQuota = (base.savedClips || 0) < config.maxClipsPerSession;
  const shouldSave = hasClipGap && hasClipQuota;

  return {
    shouldSave,
    reason: shouldSave ? "save" : hasClipQuota ? "merged_gap" : "clip_quota",
    barkCountIncrement: shouldSave ? pendingBarkCount : 0,
    nextState: {
      ...base,
      lastAcceptedAt: now,
      lastSavedAt: shouldSave ? now : base.lastSavedAt || 0,
      savedClips: shouldSave ? (base.savedClips || 0) + 1 : base.savedClips || 0,
      pendingBarkCount: shouldSave ? 0 : pendingBarkCount
    }
  };
}
