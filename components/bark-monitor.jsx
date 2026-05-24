"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpToLine,
  AudioWaveform,
  Brain,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FlaskConical,
  Mic,
  MicOff,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Tag,
  Volume2,
  XCircle
} from "lucide-react";
import { CapsuleTabs, Popup } from "antd-mobile";
import BarkLabelManager from "@/components/bark-label-manager";
import { DEFAULT_BARK_LABEL_OPTIONS, mergeBarkLabelOptions } from "@/lib/bark-label-options";
import {
  BARK_DETECTOR_VERSION,
  BARK_SENSITIVITY_CONFIG,
  buildBarkEmbedding,
  clamp,
  getBarkAcousticProfile,
  getBarkFrameDecision,
  getBarkSessionCapturePlan,
  getInitialBarkSessionState
} from "@/lib/bark-analysis";
import { formatDateTime } from "@/lib/domain";

const DETECTION_FEATURES = ["rms", "zcr", "spectralCentroid", "spectralFlatness", "spectralRolloff"];
const CLIP_TAIL_MS = 1300;
const MAX_ROLLING_CHUNKS = 8;
const SPECTROGRAM_BANDS = 32;
const SPECTROGRAM_FRAME_LIMIT = 96;
const ANALYZE_INTERVAL_MS = 140;
const HIDDEN_ANALYZE_INTERVAL_MS = 320;
const UI_UPDATE_INTERVAL_MS = 280;
const sensitivityConfig = BARK_SENSITIVITY_CONFIG;

const fallbackReasonOptions = DEFAULT_BARK_LABEL_OPTIONS;

const emptyAnalysis = {
  averageScore: 0,
  profileDistribution: [],
  hourlyCounts: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
  clusterStats: [],
  sessionStats: { total: 0, averageSamples: 0, averageBarks: 0 },
  filterStats: { storedSamples: 0, possibleHumanVoice: 0, activeProfiles: 0, clusteredSamples: 0 }
};

function formatDuration(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "短时";
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  return seconds >= 60 ? `${Math.round(seconds / 60)} 分钟` : `${seconds} 秒`;
}

function getSessionDateKey(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatSessionDateLabel(key) {
  if (key === getSessionDateKey(new Date())) return "今天";
  const [, month, day] = key.split("-");
  return `${month}/${day}`;
}

function formatSessionWeekday(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(year, month - 1, day));
}

function formatSessionTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function getReasonLabel(reason, options = fallbackReasonOptions) {
  if (reason === "false_positive" || reason === "false-positive") return "不是狗叫";
  return options.find((item) => item.id === reason)?.label || reason || "";
}

function minutesSince(typeSet, timelineEvents, now) {
  const match = timelineEvents.find((event) => typeSet.has(event.type));
  if (!match) return null;
  return Math.max(0, Math.round((now - new Date(match.happenedAt)) / 60000));
}

function getTimeContext(timelineEvents, now = new Date()) {
  const oneHourAgo = new Date(now.getTime() - 60 * 60000);
  return {
    hour: now.getHours(),
    sinceFoodMinutes: minutesSince(new Set(["FOOD"]), timelineEvents, now),
    sincePottyMinutes: minutesSince(new Set(["POTTY", "STOOL"]), timelineEvents, now),
    recentEventCount: timelineEvents.filter((event) => new Date(event.happenedAt) >= oneHourAgo).length
  };
}

function calculateZeroCrossingRate(signal) {
  let crossings = 0;
  for (let index = 1; index < signal.length; index += 1) {
    if ((signal[index - 1] < 0 && signal[index] >= 0) || (signal[index - 1] >= 0 && signal[index] < 0)) crossings += 1;
  }
  return signal.length ? crossings / signal.length : 0;
}

function calculateWaveform(signal, buckets = 72) {
  if (!signal?.length) return [];
  const bucketSize = Math.max(1, Math.floor(signal.length / buckets));
  const values = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    let sum = 0;
    let count = 0;
    for (let index = bucket * bucketSize; index < Math.min(signal.length, (bucket + 1) * bucketSize); index += 1) {
      sum += Math.abs(signal[index]);
      count += 1;
    }
    values.push(Number(clamp((sum / Math.max(1, count)) * 2).toFixed(3)));
  }
  return values;
}

function calculateSpectrogramFrame(frequency, bands = SPECTROGRAM_BANDS) {
  if (!frequency?.length) return [];
  const maxBin = Math.max(1, Math.floor(frequency.length * 0.72));
  const frame = [];
  for (let band = 0; band < bands; band += 1) {
    const start = Math.floor((band / bands) ** 1.55 * maxBin);
    const end = Math.max(start + 1, Math.floor(((band + 1) / bands) ** 1.55 * maxBin));
    let peak = 0;
    let sum = 0;
    let count = 0;
    for (let index = start; index < Math.min(maxBin, end); index += 1) {
      const value = frequency[index] / 255;
      peak = Math.max(peak, value);
      sum += value;
      count += 1;
    }
    frame.push(Number(clamp(peak * 0.76 + (sum / Math.max(1, count)) * 0.52).toFixed(3)));
  }
  return frame;
}

function normalizeSpectrogramFrames(frames = [], frameLimit = SPECTROGRAM_FRAME_LIMIT, bands = SPECTROGRAM_BANDS) {
  if (!Array.isArray(frames)) return [];
  const cleanFrames = frames
    .map((frame) =>
      Array.isArray(frame)
        ? frame
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
            .slice(0, bands)
        : []
    )
    .filter((frame) => frame.length);

  if (cleanFrames.length <= frameLimit) return cleanFrames;
  const bucketSize = cleanFrames.length / frameLimit;
  return Array.from({ length: frameLimit }, (_, bucket) => {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
    return Array.from({ length: bands }, (_, band) => {
      let peak = 0;
      for (let index = start; index < Math.min(cleanFrames.length, end); index += 1) {
        peak = Math.max(peak, Number(cleanFrames[index]?.[band] || 0));
      }
      return Number(clamp(peak).toFixed(3));
    });
  });
}

function getRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const playbackProbe = typeof document !== "undefined" ? document.createElement("audio") : null;
  const options = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return (
    options.find((type) => {
      if (!MediaRecorder.isTypeSupported(type)) return false;
      return !playbackProbe || playbackProbe.canPlayType(type) !== "";
    }) ||
    options.find((type) => MediaRecorder.isTypeSupported(type)) ||
    ""
  );
}

function getAudioExtension(contentType = "") {
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

function MetricChip({ label, value }) {
  return (
    <div className="barkMetricChip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarkSubpageTop({ title, subtitle, onBack }) {
  return (
    <div className="subpageTop">
      <button className="backButton" type="button" onClick={onBack}>
        返回
      </button>
      <div>
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
    </div>
  );
}

function BarkSectionCard({ icon: Icon, title, subtitle, meta, onClick }) {
  return (
    <button className="sectionMenuCard" type="button" onClick={onClick}>
      <span className="sectionMenuIcon">{Icon ? <Icon size={18} /> : null}</span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      {meta ? <em>{meta}</em> : null}
      <ChevronRight size={16} />
    </button>
  );
}

function Waveform({ values = [] }) {
  const bars = values.length ? values : Array.from({ length: 24 }, () => 0.08);
  return (
    <div className="barkWaveform" aria-label="音频波形">
      {bars.map((value, index) => (
        <i key={`${index}-${value}`} style={{ height: `${Math.max(12, Math.round(clamp(value) * 100))}%` }} />
      ))}
    </div>
  );
}

function spectrogramHeatColor(intensity) {
  const t = clamp(intensity);
  if (t < 0.15) return [5, 15, 47, Math.round(60 + t * 400)];
  if (t < 0.35) {
    const p = (t - 0.15) / 0.2;
    return [Math.round(10 + p * 30), Math.round(20 + p * 60), Math.round(110 + p * 90), Math.round(160 + p * 80)];
  }
  if (t < 0.55) {
    const p = (t - 0.35) / 0.2;
    return [Math.round(40 + p * 80), Math.round(140 + p * 80), Math.round(200 - p * 40), Math.round(220 + p * 35)];
  }
  if (t < 0.75) {
    const p = (t - 0.55) / 0.2;
    return [Math.round(120 + p * 120), Math.round(210 - p * 40), Math.round(80 + p * 40), 255];
  }
  const p = (t - 0.75) / 0.25;
  return [Math.round(240 + p * 15), Math.round(170 + p * 70), Math.round(60 + p * 40), 255];
}

function SpectrogramView({ sample, compact = false }) {
  const canvasRef = useRef(null);
  const features = sample.features || {};
  const storedFrames = normalizeSpectrogramFrames(sample.spectrogram || features.spectrogram || [], compact ? 52 : 84, SPECTROGRAM_BANDS);
  const fallbackWaveform = sample.waveform?.length ? sample.waveform : Array.from({ length: compact ? 40 : 72 }, () => 0.05);
  const embedding = sample.embedding?.length ? sample.embedding : buildBarkEmbedding(features);
  const columns = storedFrames.length || (compact ? 52 : 84);
  const rows = compact ? 18 : 30;
  const highRatio = clamp(Number(features.highRatio || 0));
  const centroid = clamp(Number(features.centroid || 0));
  const flux = clamp(Number(features.spectralFlux || 0) * 5);
  const flatness = clamp(Number(features.spectralFlatness || 0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const displayWidth = canvas.clientWidth || canvas.offsetWidth || 300;
    const displayHeight = canvas.clientHeight || canvas.offsetHeight || 120;
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cellW = displayWidth / columns;
    const cellH = displayHeight / rows;

    for (let x = 0; x < columns; x += 1) {
      const sourceFrame = storedFrames[x];
      const wave = clamp(Number(fallbackWaveform[Math.floor((x / columns) * fallbackWaveform.length)] || 0));
      const embed = clamp(Math.abs(Number(embedding[x % Math.max(1, embedding.length)] || 0)));
      for (let y = 0; y < rows; y += 1) {
        const frequency = 1 - y / Math.max(1, rows - 1);
        const frameBand = sourceFrame
          ? sourceFrame[Math.min(sourceFrame.length - 1, Math.max(0, Math.round((1 - frequency) * (sourceFrame.length - 1))))]
          : null;
        const harmonic = Math.exp(-Math.abs(frequency - (0.18 + centroid * 0.62)) * (8 + flux * 8));
        const highEnergy = frequency > 0.58 ? highRatio * 0.46 : 0;
        const texture = flatness * 0.08 * ((x + y) % 3);
        const intensity = sourceFrame
          ? clamp(Number(frameBand || 0) * 1.34 + wave * 0.18 + embed * 0.05)
          : clamp(wave * 0.42 + embed * 0.12 + harmonic * wave * 0.95 + highEnergy + texture);

        const [r, g, b, a] = spectrogramHeatColor(intensity);
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(Math.floor(x * cellW), Math.floor(y * cellH), Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
      }
    }

    // Draw subtle grid overlay for professional look
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    for (let y = 0; y < rows; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(displayWidth, y * cellH);
      ctx.stroke();
    }
  }, [columns, rows, storedFrames, fallbackWaveform, embedding, highRatio, centroid, flux, flatness]);

  return (
    <div className="barkSpectrogram" aria-label="专业声谱图">
      <div className="barkSpectrogramAxis">
        <span>8k</span>
        <span>4k</span>
        <span>0</span>
      </div>
      <canvas ref={canvasRef} className="barkSpectrogramCanvas" />
      <span className="barkSpectrogramMode">{storedFrames.length ? "FFT 频谱" : "旧样本估算"}</span>
    </div>
  );
}

function downsampleWaveform(values, maxPoints = 180) {
  if (!values.length || values.length <= maxPoints) return values;
  const bucketSize = values.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, bucket) => {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
    let peak = 0;
    for (let index = start; index < Math.min(values.length, end); index += 1) {
      peak = Math.max(peak, Number(values[index] || 0));
    }
    return Number(clamp(peak).toFixed(3));
  });
}

function buildSessionWaveform(samples) {
  const sorted = [...samples].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const values = [];
  for (const sample of sorted) {
    const waveform = sample.waveform?.length ? sample.waveform : [0.08, 0.1, 0.08];
    if (values.length) values.push(0.03, 0.02, 0.03);
    values.push(...waveform);
  }
  return downsampleWaveform(values, 180);
}

function SessionVoiceprint({ values = [], markers = [] }) {
  const bars = values.length ? values : Array.from({ length: 40 }, () => 0.06);
  return (
    <div className="barkSessionVoiceprint" aria-label="叫声段声纹">
      <div className="barkSessionWaveBars">
        {bars.map((value, index) => (
          <i key={`${index}-${value}`} style={{ height: `${Math.max(7, Math.round(clamp(value) * 100))}%` }} />
        ))}
      </div>
      <div className="barkSessionMarkers">
        {markers.map((marker) => (
          <span key={marker.id} style={{ left: `${marker.left}%` }} title={marker.title} />
        ))}
      </div>
    </div>
  );
}

const voiceprintMetricDefinitions = [
  { key: "rms", label: "响度", scale: 4 },
  { key: "peak", label: "峰值", scale: 3 },
  { key: "relativeRms", label: "突增", scale: 0.2 },
  { key: "centroid", label: "频心", scale: 1 },
  { key: "highRatio", label: "高频", scale: 1 },
  { key: "spectralFlux", label: "变化", scale: 5 },
  { key: "spectralCrest", label: "尖锐", scale: 1 },
  { key: "zcr", label: "过零", scale: 2 },
  { key: "spectralFlatness", label: "粗糙", scale: 1 }
];

function formatVoiceprintValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.00";
  return number >= 10 ? String(Math.round(number)) : number.toFixed(2);
}

function VoiceprintDetails({ sample, compact = false }) {
  const features = sample.features || {};
  const profile = getBarkAcousticProfile(features);
  const embedding = sample.embedding?.length ? sample.embedding : buildBarkEmbedding(features);
  const tags = [
    profile.energy === "strong" ? "强能量" : profile.energy === "soft" ? "低能量" : "中能量",
    profile.pitch === "high" ? "高频声纹" : profile.pitch === "low" ? "低频声纹" : "中频声纹",
    profile.burst === "sharp" ? "短促爆发" : profile.burst === "steady" ? "持续平稳" : "起伏混合",
    profile.texture === "noisy" ? "粗糙质感" : profile.texture === "tonal" ? "清亮质感" : "均衡质感"
  ];

  return (
    <details className={`barkVoiceprintDetails ${compact ? "compact" : ""}`}>
      <summary>
        <AudioWaveform size={14} />
        详细声纹
        <span>{profile.label}</span>
      </summary>
      <div className="barkVoiceprintTags">
        {tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="barkVoiceprintMetrics">
        {voiceprintMetricDefinitions.map((metric) => {
          const rawValue = Number(features[metric.key] || 0);
          const width = Math.round(clamp(rawValue * metric.scale) * 100);
          return (
            <div className="barkVoiceprintMetric" key={metric.key}>
              <span>{metric.label}</span>
              <div><i style={{ width: `${Math.max(4, width)}%` }} /></div>
              <b>{formatVoiceprintValue(rawValue)}</b>
            </div>
          );
        })}
      </div>
      <div className="barkEmbeddingStrip" aria-label="embedding 指纹">
        {embedding.map((value, index) => (
          <i key={`${index}-${value}`} title={`embedding ${index + 1}: ${formatVoiceprintValue(value)}`} style={{ height: `${Math.max(8, Math.round(clamp(value) * 100))}%` }} />
        ))}
      </div>
    </details>
  );
}

function getAudioErrorText(audio, playError) {
  if (playError?.name === "NotAllowedError") return "浏览器拦截了自动播放，请点下方原生播放器。";
  if (playError?.name === "NotSupportedError") return "这段音频格式当前浏览器不支持。";
  if (String(playError?.message || "").toLowerCase().includes("failed to fetch")) {
    return "音频文件没有成功取到，可能是网络、登录态或对象存储读取失败。";
  }
  const code = audio?.error?.code;
  if (code === 2) return "音频网络加载失败，请稍后重试。";
  if (code === 3) return "音频解码失败，可能是片段文件不完整。";
  if (code === 4) return "浏览器不支持这段音频格式。";
  return "播放失败，请点下方原生播放器或重新采集一段。";
}

async function getAudioRouteDiagnostic(audioSrc) {
  if (!audioSrc?.startsWith("/api/")) return "";
  try {
    const response = await fetch(audioSrc, { method: "HEAD", credentials: "same-origin" });
    if (response.status === 206 || response.ok) return "音频接口可读取，当前更像是浏览器解码或格式兼容问题。";
    if (response.status === 404) return "音频索引存在但文件对象没有找到，需要重新采集或检查 R2 同步。";
    if (response.status === 422) return "这条记录保存的是空音频，只能用于声纹分析。";
    return `音频接口返回 ${response.status}，请稍后重试或重新采集。`;
  } catch {
    return "音频接口探测失败，可能是网络或登录状态中断。";
  }
}

function RecommendationBadge({ sample, labelOptions = fallbackReasonOptions }) {
  if (sample.modelSuggestion) {
    return (
      <div className="barkModelBadge strong">
        <Brain size={13} />
        <span>学习推荐 {getReasonLabel(sample.modelSuggestion, labelOptions)} · {Math.round((sample.modelConfidence || 0) * 100)}%</span>
      </div>
    );
  }
  if (sample.ruleSuggestion) {
    return (
      <div className="barkModelBadge">
        <Brain size={13} />
        <span>规则猜测 {getReasonLabel(sample.ruleSuggestion, labelOptions)} · {Math.round((sample.ruleConfidence || 0) * 100)}%</span>
      </div>
    );
  }
  return null;
}

function getRepresentativeSample(session, samples) {
  return (
    samples.find((sample) => sample.id === session.representativeSampleId) ||
    [...samples].sort((a, b) => Number(b.barkScore || 0) - Number(a.barkScore || 0))[0] ||
    null
  );
}

function SampleCard({ sample, compact = false, onLabel, onPlay, player, labelOptions = fallbackReasonOptions }) {
  const score = Math.round((sample.barkScore || 0) * 100);
  const statusText = sample.status === "confirmed" ? "已确认" : sample.status === "false_positive" ? "误报" : "待归类";
  const reasonLabel = getReasonLabel(sample.reason, labelOptions);
  const profile = getBarkAcousticProfile(sample.features || {});
  const isActive = player.sampleId === sample.id;
  const isPlaying = isActive && player.status === "playing";
  const hasAudioPath = Boolean(sample.audioUrl || sample.audioObjectKey);
  const knownEmptyAudio = sample.audioSizeBytes != null && Number(sample.audioSizeBytes) <= 0 && !hasAudioPath;
  const canPlay = hasAudioPath && !knownEmptyAudio;

  return (
    <article className={`barkSampleCard ${compact ? "compact" : ""}`}>
      <div className="barkSampleTopline">
        <span>{formatDateTime(sample.capturedAt)}</span>
        <b>{score}%</b>
        <em>{reasonLabel || statusText}</em>
      </div>
      <div className="barkProfileLine">
        <span>{profile.label}</span>
        {sample.sessionId ? <em>已归入叫声段</em> : null}
      </div>
      <Waveform values={sample.waveform} />
      <SpectrogramView sample={sample} compact={compact} />
      <VoiceprintDetails sample={sample} compact={compact} />
      <RecommendationBadge sample={sample} labelOptions={labelOptions} />
      {sample.ruleReason && !sample.modelSuggestion ? <p className="barkRuleReason">{sample.ruleReason}</p> : null}
      {canPlay ? (
        <button className={`barkPlayButton ${isActive ? "active" : ""}`} type="button" onClick={() => onPlay(sample)}>
          {isPlaying ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
          {isPlaying ? "暂停" : isActive && player.status === "loading" ? "载入中" : "播放片段"}
        </button>
      ) : (
        <p className="mutedText">
          {knownEmptyAudio ? "这段音频为空，只有声纹特征。" : "这个样本只有声纹，没有可回放音频。"}
        </p>
      )}
      {!compact ? (
        <div className="barkQuickLabels">
          {labelOptions.map((option) => (
            <button className="secondaryButton" type="button" key={option.id} onClick={() => onLabel(sample, option.id)}>
              <CheckCircle2 size={14} />
              {option.label}
            </button>
          ))}
          <button className="miniDangerButton" type="button" onClick={() => onLabel(sample, "false-positive")}>
            <XCircle size={14} />
            不是狗叫
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ClusterCard({ cluster, samples, onLabel, onPlay, player, clusterStat, labelOptions = fallbackReasonOptions }) {
  const latest = samples[0];
  const pendingCount = samples.filter((sample) => sample.status === "candidate").length;
  const profile = clusterStat?.profile || getBarkAcousticProfile(latest?.features || {});
  const label = cluster.reason ? getReasonLabel(cluster.reason, labelOptions) || cluster.reason : profile.label || "未命名声音";

  return (
    <section className="barkClusterCard">
      <div className="barkClusterHeader">
        <div>
          <strong>{label}</strong>
          <span>{samples.length} 条样本 · {pendingCount} 条待确认 · {profile.label}</span>
        </div>
        <b>{latest ? Math.round((latest.barkScore || 0) * 100) : 0}%</b>
      </div>
      {latest ? <SampleCard sample={latest} compact onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} /> : null}
      <div className="barkQuickLabels clusterLabels">
        {labelOptions.map((option) => (
          <button className="secondaryButton" type="button" key={option.id} onClick={() => latest && onLabel(latest, option.id)}>
            {option.label}
          </button>
        ))}
        <button className="miniDangerButton" type="button" onClick={() => latest && onLabel(latest, "false-positive")}>
          不是狗叫
        </button>
      </div>
      {samples.length > 1 ? (
        <details className="barkClusterDetails">
          <summary>查看同组其余 {samples.length - 1} 条</summary>
          <div className="barkSampleStack">
            {samples.slice(1).map((sample) => (
              <SampleCard sample={sample} key={sample.id} compact onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SessionCard({ session, samples, onLabel, onPlay, player, labelOptions = fallbackReasonOptions }) {
  const sortedSamples = [...samples].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const displaySamples = [...samples].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  const representative = getRepresentativeSample(session, samples);
  const profile = getBarkAcousticProfile(representative?.features || session.summary?.lastProfile || {});
  const waveform = buildSessionWaveform(sortedSamples);
  const maxIndex = Math.max(1, sortedSamples.length - 1);
  const markers = sortedSamples.slice(0, 8).map((sample, index) => ({
    id: sample.id,
    left: sortedSamples.length === 1 ? 50 : Math.round((index / maxIndex) * 100),
    title: `${formatDateTime(sample.capturedAt)} · ${Math.round((sample.barkScore || 0) * 100)}%`
  }));
  const score = Math.round((representative?.barkScore || session.summary?.maxScore || 0) * 100);
  const suggestion = session.modelSuggestion || representative?.modelSuggestion || session.ruleSuggestion || representative?.ruleSuggestion;
  const confidence = session.modelConfidence || representative?.modelConfidence || session.ruleConfidence || representative?.ruleConfidence;
  const suggestionPrefix = session.modelSuggestion || representative?.modelSuggestion ? "学习推荐" : "规则猜测";
  const statusText = session.status === "confirmed" ? "已确认" : session.status === "false_positive" ? "误报" : "待校准";

  return (
    <section className="barkSessionCard">
      <div className="barkSessionHeader">
        <div>
          <strong>{formatDateTime(session.startedAt)}</strong>
          <span>
            {formatDuration(session.startedAt, session.endedAt)} · {session.barkCount || session.sampleCount || samples.length} 次触发 · {samples.length} 段音频
          </span>
        </div>
        <b>{score}%</b>
      </div>
      <SessionVoiceprint values={waveform} markers={markers} />
      <div className="barkSessionMeta">
        <span>{profile.label}</span>
        <span>{statusText}</span>
        {suggestion ? <strong>{suggestionPrefix} {getReasonLabel(suggestion, labelOptions)} · {Math.round((confidence || 0) * 100)}%</strong> : <em>模型待学习</em>}
      </div>
      {representative ? (
        <SampleCard sample={representative} compact onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} />
      ) : (
        <p className="mutedText">这个叫声段还没有代表片段。</p>
      )}
      {displaySamples.length > 1 ? (
        <details className="barkClusterDetails">
          <summary>查看本段其余 {displaySamples.length - 1} 条片段</summary>
          <div className="barkSampleStack">
            {displaySamples
              .filter((sample) => sample.id !== representative?.id)
              .map((sample) => (
                <SampleCard sample={sample} key={sample.id} compact onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} />
              ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SessionDetailPopup({ group, onClose, onLabel, onPlay, player, labelOptions = fallbackReasonOptions }) {
  if (!group) return null;
  const { session, samples } = group;
  const representative = getRepresentativeSample(session, samples);
  const displaySamples = [...samples]
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
    .filter((sample) => sample.id !== representative?.id);
  const score = Math.round((representative?.barkScore || 0) * 100);
  const statusText = session.status === "confirmed" ? "已确认" : session.status === "false_positive" ? "误报" : "待校准";

  return (
    <Popup
      visible={Boolean(group)}
      onMaskClick={onClose}
      onClose={onClose}
      position="bottom"
      bodyClassName="barkDetailPopup"
      closeOnSwipe
    >
      <section className="barkDetailSheet">
        <div className="sectionHeading">
          <p>片段详情</p>
          <span>{formatDateTime(session.startedAt)}</span>
        </div>
        <div className="barkSessionMeta compact">
          <span>{formatDuration(session.startedAt, session.endedAt)}</span>
          <span>{session.barkCount || session.sampleCount || samples.length} 次触发</span>
          <strong>{score}%</strong>
          <em>{statusText}</em>
        </div>
        {representative ? (
          <SampleCard sample={representative} onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} />
        ) : null}
        {displaySamples.length ? (
          <details className="barkClusterDetails" open>
            <summary>本段其余 {displaySamples.length} 条片段</summary>
            <div className="barkSampleStack">
              {displaySamples.map((sample) => (
                <SampleCard sample={sample} key={sample.id} compact onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} />
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </Popup>
  );
}

function CompactSessionList({
  dateGroups,
  selectedDateKey,
  onSelectDateKey,
  onOpenDetail,
  onPlay,
  player,
  labelOptions = fallbackReasonOptions
}) {
  const selectedGroup = dateGroups.find((group) => group.key === selectedDateKey) || dateGroups[0];

  if (!dateGroups.length) {
    return <p className="mutedText">还没有声音样本。建议先用“降误报”监听一段时间，再回来看声纹段。</p>;
  }

  return (
    <section className="barkSessionCompactPanel">
      <CapsuleTabs className="barkDateTabs" activeKey={selectedGroup?.key} onChange={onSelectDateKey}>
        {dateGroups.map((group) => (
          <CapsuleTabs.Tab key={group.key} title={`${group.label} ${group.subLabel}`} />
        ))}
      </CapsuleTabs>
      <div className="barkSessionRows">
        {(selectedGroup?.groups || []).map((group) => {
          const representative = getRepresentativeSample(group.session, group.samples);
          const score = Math.round((representative?.barkScore || 0) * 100);
          const isActive = player.sampleId === representative?.id;
          const isPlaying = isActive && player.status === "playing";
          const reason = group.session.modelSuggestion || representative?.modelSuggestion || group.session.reason || representative?.reason;
          const label = getReasonLabel(reason, labelOptions) || "待细分";

          return (
            <article className={`barkSessionRow ${isActive ? "active" : ""}`} key={group.session.id}>
              <div className="barkSessionRowMain">
                <strong>{formatSessionTime(group.session.startedAt)}</strong>
                <span>{formatDuration(group.session.startedAt, group.session.endedAt)} · {group.session.barkCount || group.session.sampleCount || group.samples.length} 次</span>
              </div>
              <em>{label}</em>
              <b>{score}%</b>
              <button className="miniActionButton" type="button" onClick={() => representative && onPlay(representative)} disabled={!representative}>
                {isPlaying ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                {isPlaying ? "暂停" : "播放"}
              </button>
              <button className="miniActionButton" type="button" onClick={() => onOpenDetail(group.session.id)}>
                详情
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BarkLearningPanel({ model, summary, clusters, onRebuild, rebuilding }) {
  const learning = model?.learning || {};
  const metrics = model?.metrics || {};
  const sourceLabel =
    model?.source === "artifact" ? "云端模型" : model?.source === "feedback" ? "即时学习" : "待标注";
  const ready = Boolean(learning.ready);
  const nextCluster = clusters.find((cluster) => cluster.id === learning.nextClusterId);
  const nextLabel = nextCluster?.label || nextCluster?.reason || "最大待校准声音组";

  return (
    <section className="barkLearningPanel">
      <div className="sectionHeading compact">
        <p>学习推荐</p>
        <span>{sourceLabel} · {ready ? "已可给出推荐" : "先标 1-2 组声音"}</span>
      </div>
      <div className="barkLearningGrid">
        <MetricChip label="已标样本" value={learning.labeledSampleCount || 0} />
        <MetricChip label="标签类型" value={learning.classCount || 0} />
        <MetricChip label="待校准组" value={learning.pendingClusterCount || 0} />
      </div>
      <div className="barkLearningCopy">
        <strong>{ready ? "已根据你的标注即时学习" : "还没有足够反馈"}</strong>
        <span>
          {ready
            ? `当前覆盖 ${summary.total || 0} 条样本，训练样本 ${metrics.labeledSampleCount || learning.labeledSampleCount || 0} 条。`
            : "先播放每个声音组的代表片段，然后给整组标注原因；之后新片段会自动出现学习推荐。"}
        </span>
      </div>
      <div className="barkLearningActions">
        {learning.nextClusterId ? <span>下一步：校准「{nextLabel}」里的 {learning.nextClusterSampleCount} 条</span> : <span>没有待校准声音组</span>}
        <button className="miniActionButton" type="button" onClick={onRebuild} disabled={rebuilding}>
          <RefreshCw size={14} />
          {rebuilding ? "重算中" : "重算聚类"}
        </button>
      </div>
    </section>
  );
}

function LocalTrainingPanel({ state, runningAction, onAction, onLabel, onPlay, player, labelOptions = fallbackReasonOptions }) {
  const summary = state?.summary || {};
  const localModel = state?.localModel || { metrics: {}, prototypes: [] };
  const lastStatus = state?.status || {};
  const pendingClusters = (state?.clusters || []).filter((cluster) => cluster.pendingCount > 0).slice(0, 6);
  const maxPrototypeCount = Math.max(1, ...(localModel.prototypes || []).map((item) => item.sampleCount || 0));
  const maxLabelCount = Math.max(1, ...(state?.labelDistribution || []).map((item) => item.count || 0));

  return (
    <section className="contentPanel barkTrainingWorkbench">
      <div className="sectionHeading">
        <p>本地训练台</p>
        <span>先拉云端数据到本地，再本地标注和训练，最后再推云端</span>
      </div>

      <div className="barkTrainingActions">
        <button className="secondaryButton" type="button" onClick={() => onAction("download")} disabled={Boolean(runningAction)}>
          <Download size={14} />
          {runningAction === "download" ? "拉取中" : "拉取云端数据"}
        </button>
        <button className="secondaryButton" type="button" onClick={() => onAction("train")} disabled={Boolean(runningAction)}>
          <FlaskConical size={14} />
          {runningAction === "train" ? "训练中" : "本地训练"}
        </button>
        <button className="secondaryButton" type="button" onClick={() => onAction("push")} disabled={Boolean(runningAction)}>
          <ArrowUpToLine size={14} />
          {runningAction === "push" ? "推送中" : "推送结果"}
        </button>
        <button className="miniActionButton" type="button" onClick={() => onAction("sync")} disabled={Boolean(runningAction)}>
          <RefreshCw size={14} />
          {runningAction === "sync" ? "执行中" : "一键全流程"}
        </button>
      </div>

      <div className="barkTrainingSummary">
        <MetricChip label="本地样本" value={summary.sampleCount || 0} />
        <MetricChip label="已标样本" value={summary.labeledSampleCount || 0} />
        <MetricChip label="本地聚类" value={summary.clusterCount || 0} />
        <MetricChip label="已下载音频" value={summary.audioDownloaded || 0} />
      </div>

      <div className="barkTrainingStatusCard">
        <div className="sectionHeading compact">
          <p>训练状态</p>
          <span>{lastStatus.finishedAt ? formatDateTime(lastStatus.finishedAt) : "尚未执行本地训练动作"}</span>
        </div>
        <div className="barkTrainingStatusMeta">
          <span><Tag size={13} /> {localModel.source === "artifact" ? "已保存本地 artifact" : "按当前本地标签实时预估"}</span>
          <span><Brain size={13} /> {localModel.metrics?.classCount || 0} 个标签类型</span>
          <span><FlaskConical size={13} /> 训练准确率 {Math.round((localModel.metrics?.trainingAccuracy || 0) * 100)}%</span>
        </div>
        {lastStatus.output ? (
          <details className="barkTrainingLog">
            <summary>查看上次执行输出</summary>
            <pre>{lastStatus.output}</pre>
          </details>
        ) : (
          <p className="mutedText">先点“拉取云端数据”把 `data/bark-sync/` 更新到本地，再开始标注和训练。</p>
        )}
      </div>

      <div className="barkTrainingResultsGrid">
        <div className="barkTrainingChart">
          <div className="sectionHeading compact">
            <p>标签分布</p>
            <span>本地训练会直接使用这些人工标签</span>
          </div>
          {(state?.labelDistribution || []).length ? (
            state.labelDistribution.map((item) => (
              <div className="barkTrainRow" key={item.reason}>
                <span>{item.label}</span>
                <div><i style={{ width: `${Math.max(10, ((item.count || 0) / maxLabelCount) * 100)}%` }} /></div>
                <b>{item.count}</b>
              </div>
            ))
          ) : (
            <p className="mutedText">现在本地样本还没有人工标签，先给一两个声音组贴上原因，训练结果就会直观起来。</p>
          )}
        </div>

        <div className="barkTrainingChart">
          <div className="sectionHeading compact">
            <p>原型分类结果</p>
            <span>{localModel.version || "尚未训练"}</span>
          </div>
          {(localModel.prototypes || []).length ? (
            localModel.prototypes.map((prototype) => (
              <div className="barkTrainRow" key={prototype.label}>
                <span>{prototype.labelText}</span>
                <div><i style={{ width: `${Math.max(10, ((prototype.sampleCount || 0) / maxPrototypeCount) * 100)}%` }} /></div>
                <b>{prototype.sampleCount}</b>
                <em>{Math.round((prototype.averageSimilarity || 0) * 100)}%</em>
              </div>
            ))
          ) : (
            <p className="mutedText">还没有训练出 prototype。先本地标注，再点“本地训练”。</p>
          )}
        </div>
      </div>

      <div className="sectionHeading compact">
        <p>本地待标注聚类</p>
        <span>这里改的是本地 `data/bark-sync` 标签，适合先做训练试验</span>
      </div>
      <div className="barkLocalClusterList">
        {pendingClusters.length ? (
          pendingClusters.map((cluster) => (
            <section className="barkClusterCard" key={`local-${cluster.id}`}>
              <div className="barkClusterHeader">
                <div>
                  <strong>{cluster.reason ? getReasonLabel(cluster.reason, labelOptions) : "待标注声音组"}</strong>
                  <span>{cluster.sampleCount} 条本地样本 · 待标 {cluster.pendingCount} 条</span>
                </div>
                <b>{Math.round((cluster.representativeSample?.barkScore || 0) * 100)}%</b>
              </div>
              {cluster.representativeSample ? (
                <SampleCard sample={cluster.representativeSample} compact onLabel={onLabel} onPlay={onPlay} player={player} labelOptions={labelOptions} />
              ) : null}
              <div className="barkQuickLabels clusterLabels">
                {labelOptions.map((option) => (
                  <button className="secondaryButton" type="button" key={`${cluster.id}-${option.id}`} onClick={() => cluster.representativeSample && onLabel(cluster.representativeSample, option.id)}>
                    {option.label}
                  </button>
                ))}
                <button className="miniDangerButton" type="button" onClick={() => cluster.representativeSample && onLabel(cluster.representativeSample, "false-positive")}>
                  不是狗叫
                </button>
              </div>
            </section>
          ))
        ) : (
          <p className="mutedText">本地聚类都已经标过，或者还没拉取到本地训练数据。</p>
        )}
      </div>
    </section>
  );
}

function AnalysisPanel({ analysis, sessions }) {
  const hourlyCounts = analysis.hourlyCounts?.length ? analysis.hourlyCounts : emptyAnalysis.hourlyCounts;
  const clusterStats = analysis.clusterStats || [];
  const maxHour = Math.max(1, ...hourlyCounts.map((item) => item.count));
  const maxClusterCount = Math.max(1, ...clusterStats.map((item) => item.sampleCount || 0));
  const topClusters = clusterStats.slice(0, 6);
  const topProfiles = (analysis.profileDistribution || []).slice(0, 4);
  const recentSessions = sessions.slice(0, 4);

  return (
    <section className="contentPanel barkAnalysisPanel">
      <div className="sectionHeading">
        <p>细分分析</p>
        <span>按声学形态自动归类</span>
      </div>
      <div className="barkAnalysisGrid">
        <MetricChip label="叫声段" value={analysis.sessionStats.total} />
        <MetricChip label="平均片段" value={analysis.sessionStats.averageSamples} />
        <MetricChip label="声音画像" value={analysis.filterStats.activeProfiles} />
      </div>

      <div className="barkClusterChart" aria-label="聚类样本统计">
        <div className="sectionHeading compact">
          <p>声音组统计</p>
          <span>{topClusters.length ? "按样本数排序" : "等待样本"}</span>
        </div>
        {topClusters.length ? (
          topClusters.map((cluster) => (
            <div className="barkClusterBarRow" key={cluster.clusterId}>
              <span>{cluster.label || cluster.profile?.label || "未命名声音"}</span>
              <div>
                <i style={{ width: `${Math.max(8, ((cluster.sampleCount || 0) / maxClusterCount) * 100)}%` }} />
              </div>
              <b>{cluster.sampleCount}</b>
              <em>{Math.round((cluster.averageScore || 0) * 100)}%</em>
            </div>
          ))
        ) : (
          <p className="mutedText">采集到多段声音后，这里会显示每个聚类的样本数量和平均分数。</p>
        )}
      </div>

      <div className="barkProfileStack">
        {topProfiles.length ? (
          topProfiles.map((profile) => (
            <div className="barkProfileRow" key={profile.key}>
              <span>{profile.label}</span>
              <strong>{profile.count}</strong>
            </div>
          ))
        ) : (
          <p className="mutedText">样本积累后，这里会显示短促、持续、高亢、低沉等细分画像。</p>
        )}
      </div>

      <div className="barkHourStrip" aria-label="按小时分布">
        {hourlyCounts.map((item) => (
          <i key={item.hour} title={`${item.hour}:00 ${item.count} 次`} style={{ height: `${Math.max(8, (item.count / maxHour) * 100)}%` }} />
        ))}
      </div>

      <div className="barkSessionList">
        {recentSessions.length ? (
          recentSessions.map((session) => (
            <article className="barkSessionItem" key={session.id}>
              <div>
                <strong>{formatDateTime(session.startedAt)}</strong>
                <span>{formatDuration(session.startedAt, session.endedAt)} · {session.sampleCount} 段代表音频</span>
              </div>
              <b>{session.barkCount || session.sampleCount} 次</b>
            </article>
          ))
        ) : (
          <p className="mutedText">连续叫声会自动合并成“叫声段”，这里展示每段的持续时间和代表片段。</p>
        )}
      </div>
    </section>
  );
}

export default function BarkMonitorPanel({ pet, timelineEvents, onTimelineCreated }) {
  const [listening, setListening] = useState(false);
  const [permissionState, setPermissionState] = useState("未启动");
  const [error, setError] = useState("");
  const [sensitivity, setSensitivity] = useState("high");
  const [level, setLevel] = useState(0);
  const [barkScore, setBarkScore] = useState(0);
  const [noiseLevel, setNoiseLevel] = useState(0);
  const [samples, setSamples] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [analysis, setAnalysis] = useState(emptyAnalysis);
  const [model, setModel] = useState(null);
  const [summary, setSummary] = useState({ total: 0, today: 0, pending: 0, clustered: 0, confirmed: 0, sessions: 0 });
  const [lastSample, setLastSample] = useState(null);
  const [localTraining, setLocalTraining] = useState(null);
  const [labelOptions, setLabelOptions] = useState(fallbackReasonOptions);
  const [runningLocalAction, setRunningLocalAction] = useState("");
  const [savingSample, setSavingSample] = useState(false);
  const [rebuildingClusters, setRebuildingClusters] = useState(false);
  const [filterStats, setFilterStats] = useState({ humanVoice: 0, steadyNoise: 0, merged: 0, clipQuota: 0 });
  const [player, setPlayer] = useState({ sampleId: null, src: "", status: "idle", error: "" });
  const [selectedSessionDateKey, setSelectedSessionDateKey] = useState("");
  const [detailSessionId, setDetailSessionId] = useState("");
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [meydaReady, setMeydaReady] = useState(false);
  const [mediaRecorderReady, setMediaRecorderReady] = useState(false);
  const [activeSection, setActiveSection] = useState("home");

  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const analyzeTimerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const detectorRef = useRef({ activeFrames: 0, lastDetectedAt: 0 });
  const frequencyRef = useRef(null);
  const timeByteRef = useRef(null);
  const timeFloatRef = useRef(null);
  const previousFrequencyRef = useRef(null);
  const spectrogramRef = useRef([]);
  const noiseBaselineRef = useRef(0.025);
  const timelineEventsRef = useRef(timelineEvents);
  const sensitivityRef = useRef(sensitivity);
  const meydaRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const playerObjectUrlRef = useRef("");
  const rollingChunksRef = useRef([]);
  const recorderHeaderChunkRef = useRef(null);
  const recorderChunkIndexRef = useRef(0);
  const captureRef = useRef(null);
  const savingClipRef = useRef(false);
  const sessionStateRef = useRef(getInitialBarkSessionState());
  const filterCountersRef = useRef({ humanVoice: 0, steadyNoise: 0, merged: 0, clipQuota: 0 });
  const lastUiUpdateRef = useRef(0);

  const refreshLibrary = useCallback(async () => {
    if (!pet?.id) return;
    const response = await fetch(`/api/bark/samples?petId=${encodeURIComponent(pet.id)}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || "声音样本读取失败。");
    }
    const result = await response.json();
    setSamples(result.samples || []);
    setClusters(result.clusters || []);
    setSessions(result.sessions || []);
    setAnalysis(result.analysis || emptyAnalysis);
    setModel(result.model || null);
    setSummary(result.summary || { total: 0, today: 0, pending: 0, clustered: 0, confirmed: 0, sessions: 0 });
  }, [pet?.id]);

  const refreshLocalTraining = useCallback(async () => {
    if (!pet?.id) return;
    const response = await fetch(`/api/bark/training/local?petId=${encodeURIComponent(pet.id)}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || "本地训练数据读取失败。");
    }
    const result = await response.json();
    setLocalTraining(result);
  }, [pet?.id]);

  const refreshLabelOptions = useCallback(async () => {
    if (!pet?.id) return;
    const response = await fetch(`/api/bark/labels?petId=${encodeURIComponent(pet.id)}`);
    if (!response.ok) return;
    const result = await response.json();
    setLabelOptions(mergeBarkLabelOptions(result.labels || []));
  }, [pet?.id]);

  const groupedClusters = useMemo(() => {
    const byCluster = new Map();
    for (const sample of samples) {
      const key = sample.clusterId || "unclustered";
      if (!byCluster.has(key)) byCluster.set(key, []);
      byCluster.get(key).push(sample);
    }
    return [...byCluster.entries()]
      .map(([clusterId, groupSamples]) => ({
        cluster: clusters.find((clusterItem) => clusterItem.id === clusterId) || {
          id: clusterId,
          reason: null,
          status: "unlabeled",
          sampleCount: groupSamples.length
        },
        samples: groupSamples.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
      }))
      .sort((a, b) => new Date(b.samples[0]?.capturedAt || 0) - new Date(a.samples[0]?.capturedAt || 0));
  }, [clusters, samples]);

  const groupedSessions = useMemo(() => {
    const bySession = new Map();
    const ungrouped = [];
    for (const sample of samples) {
      if (!sample.sessionId) {
        ungrouped.push(sample);
        continue;
      }
      if (!bySession.has(sample.sessionId)) bySession.set(sample.sessionId, []);
      bySession.get(sample.sessionId).push(sample);
    }

    const sessionGroups = sessions.map((session) => ({
      session,
      samples: (bySession.get(session.id) || []).sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
    }));

    for (const sample of ungrouped) {
      sessionGroups.push({
        session: {
          id: `sample-${sample.id}`,
          startedAt: sample.capturedAt,
          endedAt: sample.capturedAt,
          sampleCount: 1,
          barkCount: 1,
          representativeSampleId: sample.id,
          status: sample.status,
          reason: sample.reason,
          summary: {},
          modelSuggestion: sample.modelSuggestion,
          modelConfidence: sample.modelConfidence,
          modelVersion: sample.modelVersion
        },
        samples: [sample]
      });
    }

    return sessionGroups
      .filter((group) => group.samples.length)
      .sort((a, b) => new Date(b.session.startedAt || b.samples[0]?.capturedAt || 0) - new Date(a.session.startedAt || a.samples[0]?.capturedAt || 0));
  }, [samples, sessions]);

  const sessionDateGroups = useMemo(() => {
    const byDate = new Map();
    for (const group of groupedSessions) {
      const key = getSessionDateKey(group.session.startedAt || group.samples[0]?.capturedAt || new Date());
      if (!byDate.has(key)) {
        byDate.set(key, {
          key,
          label: formatSessionDateLabel(key),
          subLabel: formatSessionWeekday(key),
          groups: []
        });
      }
      byDate.get(key).groups.push(group);
    }

    return [...byDate.values()]
      .map((group) => ({
        ...group,
        groups: group.groups.sort(
          (a, b) =>
            new Date(b.session.startedAt || b.samples[0]?.capturedAt || 0) -
            new Date(a.session.startedAt || a.samples[0]?.capturedAt || 0)
        )
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [groupedSessions]);

  const clusterStatsById = useMemo(() => {
    const map = new Map();
    for (const stat of analysis.clusterStats || []) {
      map.set(stat.clusterId, stat);
    }
    return map;
  }, [analysis.clusterStats]);

  const activePlayerSample = useMemo(() => {
    if (!player.sampleId) return null;
    return samples.find((sample) => sample.id === player.sampleId) || (lastSample?.id === player.sampleId ? lastSample : null);
  }, [lastSample, player.sampleId, samples]);

  const detailSessionGroup = useMemo(
    () => groupedSessions.find((group) => group.session.id === detailSessionId) || null,
    [detailSessionId, groupedSessions]
  );

  useEffect(() => {
    timelineEventsRef.current = timelineEvents;
  }, [timelineEvents]);

  useEffect(() => {
    if (!sessionDateGroups.length) {
      setSelectedSessionDateKey("");
      return;
    }
    if (!sessionDateGroups.some((group) => group.key === selectedSessionDateKey)) {
      setSelectedSessionDateKey(sessionDateGroups[0].key);
    }
  }, [selectedSessionDateKey, sessionDateGroups]);

  useEffect(() => {
    if (detailSessionId && !groupedSessions.some((group) => group.session.id === detailSessionId)) {
      setDetailSessionId("");
    }
  }, [detailSessionId, groupedSessions]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    refreshLibrary().catch((loadError) => setError(loadError?.message || "声音库加载失败。"));
  }, [refreshLibrary]);

  useEffect(() => {
    refreshLocalTraining().catch((loadError) => setError(loadError?.message || "本地训练台加载失败。"));
  }, [refreshLocalTraining]);

  useEffect(() => {
    refreshLabelOptions().catch(() => {});
  }, [refreshLabelOptions]);

  useEffect(() => {
    return () => {
      if (playerObjectUrlRef.current) URL.revokeObjectURL(playerObjectUrlRef.current);
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listening) return undefined;

    function handleVisibilityChange() {
      if (!document.hidden) {
        requestWakeLock();
        if (audioContextRef.current?.state === "suspended") {
          audioContextRef.current.resume().catch(() => {});
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  async function loadMeyda() {
    if (meydaRef.current) return;
    try {
      const meydaModule = await import("meyda");
      meydaRef.current = meydaModule.default || meydaModule;
      setMeydaReady(true);
    } catch {
      meydaRef.current = null;
      setMeydaReady(false);
    }
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock?.request) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLockActive(true);
      wakeLockRef.current.addEventListener("release", () => setWakeLockActive(false));
    } catch {
      setWakeLockActive(false);
    }
  }

  async function releaseWakeLock() {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch {
      // Browser may have released it already.
    } finally {
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }

  function stopRecorder() {
    captureRef.current = null;
    rollingChunksRef.current = [];
    recorderHeaderChunkRef.current = null;
    recorderChunkIndexRef.current = 0;
    spectrogramRef.current = [];
    if (mediaRecorderRef.current?.state && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setMediaRecorderReady(false);
  }

  function stopListening() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (analyzeTimerRef.current) {
      clearTimeout(analyzeTimerRef.current);
      analyzeTimerRef.current = null;
    }
    stopRecorder();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
    }
    audioContextRef.current = null;
    releaseWakeLock();
    sessionStateRef.current = getInitialBarkSessionState();
    setListening(false);
    setPermissionState("已停止");
    setLevel(0);
    setBarkScore(0);
  }

  function startRecorder(stream) {
    if (typeof MediaRecorder === "undefined") return;
    try {
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rollingChunksRef.current = [];
      recorderHeaderChunkRef.current = null;
      recorderChunkIndexRef.current = 0;
      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data?.size) return;
        const chunk = {
          id: recorderChunkIndexRef.current,
          blob: event.data
        };
        recorderChunkIndexRef.current += 1;
        if (!recorderHeaderChunkRef.current) recorderHeaderChunkRef.current = chunk;
        rollingChunksRef.current = [...rollingChunksRef.current, chunk].slice(-MAX_ROLLING_CHUNKS);
        if (captureRef.current) captureRef.current.chunks.push(chunk);
      });
      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setMediaRecorderReady(true);
    } catch {
      mediaRecorderRef.current = null;
      setMediaRecorderReady(false);
    }
  }

  async function startListening() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风采集。请用 Safari/Chrome 的 HTTPS 页面或桌面浏览器测试。");
      return;
    }

    try {
      await loadMeyda();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.58;
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      frequencyRef.current = new Uint8Array(analyser.frequencyBinCount);
      previousFrequencyRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeByteRef.current = new Uint8Array(analyser.fftSize);
      timeFloatRef.current = new Float32Array(analyser.fftSize);
      spectrogramRef.current = [];
      detectorRef.current = { activeFrames: 0, lastDetectedAt: Date.now() - sensitivityConfig[sensitivityRef.current].cooldownMs };
      sessionStateRef.current = getInitialBarkSessionState();
      filterCountersRef.current = { humanVoice: 0, steadyNoise: 0, merged: 0, clipQuota: 0 };
      setFilterStats(filterCountersRef.current);
      noiseBaselineRef.current = 0.025;
      startRecorder(stream);
      setListening(true);
      setPermissionState("低功耗监听中");
      requestWakeLock();
      scheduleAnalysis(0);
    } catch (requestError) {
      setError(requestError?.message || "麦克风权限获取失败。");
      setPermissionState("权限失败");
      setListening(false);
    }
  }

  function extractFeatures() {
    const analyser = analyserRef.current;
    const frequency = frequencyRef.current;
    const previousFrequency = previousFrequencyRef.current;
    const timeByte = timeByteRef.current;
    const timeFloat = timeFloatRef.current;
    if (!analyser || !frequency || !timeByte || !timeFloat) return null;

    analyser.getByteFrequencyData(frequency);
    analyser.getByteTimeDomainData(timeByte);
    analyser.getFloatTimeDomainData(timeFloat);
    const spectrogramFrame = calculateSpectrogramFrame(frequency);
    if (spectrogramFrame.length) {
      spectrogramRef.current = [...spectrogramRef.current, spectrogramFrame].slice(-SPECTROGRAM_FRAME_LIMIT);
    }

    let sumSquares = 0;
    let peak = 0;
    for (const value of timeByte) {
      const normalized = Math.abs((value - 128) / 128);
      sumSquares += normalized ** 2;
      peak = Math.max(peak, normalized);
    }

    const rms = Math.sqrt(sumSquares / timeByte.length);
    let total = 0;
    let weighted = 0;
    let high = 0;
    let maxBin = 0;
    let flux = 0;
    for (let index = 0; index < frequency.length; index += 1) {
      const value = frequency[index] / 255;
      const previous = previousFrequency ? previousFrequency[index] / 255 : 0;
      total += value;
      weighted += value * index;
      maxBin = Math.max(maxBin, value);
      if (index > frequency.length * 0.42) high += value;
      flux += Math.max(0, value - previous);
      if (previousFrequency) previousFrequency[index] = frequency[index];
    }

    let meydaFeatures = {};
    if (meydaRef.current?.extract) {
      try {
        meydaFeatures = meydaRef.current.extract(DETECTION_FEATURES, Array.from(timeFloat)) || {};
      } catch {
        meydaFeatures = {};
      }
    }

    const baseline = Math.max(0.012, noiseBaselineRef.current);
    const spectralFlux = clamp(flux / frequency.length);
    const zcr = meydaFeatures.zcr == null ? calculateZeroCrossingRate(timeFloat) * 3 : Number(meydaFeatures.zcr) / 120;
    const features = {
      rms,
      peak,
      relativeRms: rms / baseline,
      centroid: total ? weighted / total / frequency.length : 0,
      highRatio: total ? high / total : 0,
      spectralFlux,
      spectralCrest: total ? clamp(maxBin / (total / frequency.length) / 24) : 0,
      spectralFlatness: clamp(Number(meydaFeatures.spectralFlatness || 0)),
      zcr: clamp(zcr),
      meydaCentroid: Number(meydaFeatures.spectralCentroid || 0),
      waveform: calculateWaveform(timeFloat),
      spectrogramFrame
    };

    return features;
  }

  function updateNoiseBaseline(rms, active) {
    const current = noiseBaselineRef.current || rms || 0.025;
    const rate = active ? 0.004 : 0.025;
    noiseBaselineRef.current = current * (1 - rate) + rms * rate;
  }

  function captureAudioClip() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);

    return new Promise((resolve) => {
      const session = {
        chunks: [...rollingChunksRef.current],
        resolve
      };
      captureRef.current = session;
      recorder.requestData?.();

      window.setTimeout(() => {
        recorder.requestData?.();
        window.setTimeout(() => {
          if (captureRef.current !== session) return;
          captureRef.current = null;
          const type = recorder.mimeType || getRecorderMimeType() || "audio/webm";
          const headerChunk = recorderHeaderChunkRef.current;
          const chunks = headerChunk && !session.chunks.some((chunk) => chunk.id === headerChunk.id)
            ? [headerChunk, ...session.chunks]
            : session.chunks;
          resolve(chunks.length ? new Blob(chunks.map((chunk) => chunk.blob), { type }) : null);
        }, 140);
      }, CLIP_TAIL_MS);
    });
  }

  async function saveDetection(features, score, capturePlan) {
    if (savingClipRef.current || !pet?.id) return;
    savingClipRef.current = true;
    setSavingSample(true);
    setError("");

    try {
      const audioBlob = await captureAudioClip();
      const capturedAt = new Date().toISOString();
      const context = getTimeContext(timelineEventsRef.current, new Date(capturedAt));
      const spectrogram = normalizeSpectrogramFrames(spectrogramRef.current, SPECTROGRAM_FRAME_LIMIT, SPECTROGRAM_BANDS);
      const payloadFeatures = {
        ...features,
        spectrogram,
        ...context,
        durationMs: audioBlob ? Math.round(Math.max(CLIP_TAIL_MS, audioBlob.size / 12)) : CLIP_TAIL_MS
      };
      const embedding = buildBarkEmbedding(payloadFeatures);
      const form = new FormData();
      form.set("petId", pet.id);
      form.set("capturedAt", capturedAt);
      if (capturePlan?.nextState?.startedAt) {
        form.set("sessionStartedAt", new Date(capturePlan.nextState.startedAt).toISOString());
      }
      form.set("barkCount", String(Math.max(1, capturePlan?.barkCountIncrement || 1)));
      form.set("durationMs", String(payloadFeatures.durationMs));
      form.set("barkScore", String(Number(score.toFixed(4))));
      form.set("detectorVersion", BARK_DETECTOR_VERSION);
      form.set("features", JSON.stringify(payloadFeatures));
      form.set("embedding", JSON.stringify(embedding));
      form.set("waveform", JSON.stringify(features.waveform || []));
      form.set("spectrogram", JSON.stringify(spectrogram));
      if (audioBlob) {
        form.set("audio", audioBlob, `bark-${Date.now()}.${getAudioExtension(audioBlob.type)}`);
      }

      const response = await fetch("/api/bark/samples", {
        method: "POST",
        body: form
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "狗叫样本保存失败。");
      }
      const result = await response.json();
      setLastSample(result.sample);
      if (result.timelineEvent) onTimelineCreated?.(result.timelineEvent);
      await refreshLibrary();
    } catch (saveError) {
      setError(saveError?.message || "狗叫样本保存失败。");
    } finally {
      savingClipRef.current = false;
      setSavingSample(false);
    }
  }

  function scheduleAnalysis(delay = ANALYZE_INTERVAL_MS) {
    if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
    analyzeTimerRef.current = window.setTimeout(() => {
      analyzeTimerRef.current = null;
      rafRef.current = requestAnimationFrame(analyzeFrame);
    }, delay);
  }

  function analyzeFrame() {
    if (!analyserRef.current) return;
    const features = extractFeatures();
    if (!features) {
      scheduleAnalysis();
      return;
    }

    const decision = getBarkFrameDecision(features, sensitivityRef.current, noiseBaselineRef.current);
    const score = decision.score;
    const config = sensitivityConfig[sensitivityRef.current];
    const burst = decision.accepted;

    updateNoiseBaseline(features.rms, burst);

    if (burst) {
      detectorRef.current.activeFrames += 1;
    } else {
      detectorRef.current.activeFrames = Math.max(0, detectorRef.current.activeFrames - 1);
      if (decision.speechLike) {
        filterCountersRef.current.humanVoice += 1;
      } else if (decision.reason === "steady_noise") {
        filterCountersRef.current.steadyNoise += 1;
      }
    }

    const now = Date.now();
    if (now - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS) {
      lastUiUpdateRef.current = now;
      setLevel(features.rms);
      setBarkScore(score);
      setNoiseLevel(noiseBaselineRef.current);
      setFilterStats({ ...filterCountersRef.current });
    }

    const shouldTrigger =
      detectorRef.current.activeFrames >= config.activeFrames &&
      now - detectorRef.current.lastDetectedAt >= config.cooldownMs;

    if (shouldTrigger) {
      detectorRef.current.lastDetectedAt = now;
      detectorRef.current.activeFrames = 0;
      const capturePlan = getBarkSessionCapturePlan(sessionStateRef.current, now);
      sessionStateRef.current = capturePlan.nextState;
      if (capturePlan.shouldSave) {
        saveDetection(features, score, capturePlan);
      } else if (capturePlan.reason === "clip_quota") {
        filterCountersRef.current.clipQuota += 1;
      } else {
        filterCountersRef.current.merged += 1;
      }
    }

    const nextDelay = document.hidden ? HIDDEN_ANALYZE_INTERVAL_MS : ANALYZE_INTERVAL_MS;
    scheduleAnalysis(nextDelay);
  }

  async function labelSample(sample, reason) {
    const status = reason === "false-positive" ? "false_positive" : "confirmed";
    const response = await fetch(`/api/bark/samples/${encodeURIComponent(sample.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason,
        status,
        applyToCluster: true
      })
    });
    if (!response.ok) {
      setError("样本标注失败。");
      return;
    }
    const result = await response.json();
    setSamples(result.samples || []);
    setClusters(result.clusters || []);
    setSessions(result.sessions || []);
    setAnalysis(result.analysis || emptyAnalysis);
    setModel(result.model || null);
    setSummary(result.summary || summary);
    setLastSample(result.sample || sample);
  }

  async function rebuildClusters() {
    if (!pet?.id || rebuildingClusters) return;
    setError("");
    setRebuildingClusters(true);
    try {
      const response = await fetch("/api/bark/clusters/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ petId: pet.id })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "重新聚类失败。");
      }
      const result = await response.json();
      setSamples(result.samples || []);
      setClusters(result.clusters || []);
      setSessions(result.sessions || []);
      setAnalysis(result.analysis || emptyAnalysis);
      setModel(result.model || null);
      setSummary(result.summary || summary);
    } catch (clusterError) {
      setError(clusterError?.message || "重新聚类失败。");
    } finally {
      setRebuildingClusters(false);
    }
  }

  async function runLocalAction(action) {
    if (!pet?.id || runningLocalAction) return;
    setError("");
    setRunningLocalAction(action);
    try {
      const response = await fetch("/api/bark/training/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, petId: pet.id })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "本地训练动作执行失败。");
      }
      const result = await response.json();
      setLocalTraining(result.state || null);
      if (action === "download" || action === "sync") {
        await refreshLibrary();
      }
    } catch (actionError) {
      setError(actionError?.message || "本地训练动作执行失败。");
    } finally {
      setRunningLocalAction("");
    }
  }

  async function labelLocalSample(sample, reason) {
    setError("");
    const response = await fetch("/api/bark/training/local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        petId: pet?.id,
        sampleId: sample.id,
        reason,
        applyToCluster: true
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.message || "本地标注失败。");
      return;
    }
    const result = await response.json();
    setLocalTraining(result);
  }

  async function createProductionLabel(label) {
    if (!pet?.id) return;
    const response = await fetch("/api/bark/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ petId: pet.id, label })
    });
    if (!response.ok) {
      setError("生产标签创建失败。");
      return;
    }
    const result = await response.json();
    setLabelOptions(mergeBarkLabelOptions(result.labels || []));
  }

  async function deleteProductionLabel(id) {
    if (!pet?.id) return;
    const response = await fetch("/api/bark/labels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ petId: pet.id, id })
    });
    if (!response.ok) {
      setError("生产标签删除失败。");
      return;
    }
    const result = await response.json();
    setLabelOptions(mergeBarkLabelOptions(result.labels || []));
  }

  async function playSample(sample) {
    const audio = audioRef.current;
    if (!audio || !sample?.id) return;
    if (sample.audioSizeBytes != null && Number(sample.audioSizeBytes) <= 0 && !sample.audioUrl && !sample.audioObjectKey) {
      setPlayer({ sampleId: sample.id, src: "", status: "error", error: "这段样本没有保存到可播放音频，只能查看声纹。" });
      return;
    }
    const preferredAudioUrl = sample.localAudioUrl || sample.audioUrl || "";
    const audioSrc = preferredAudioUrl?.startsWith("/api/")
      ? preferredAudioUrl
      : `/api/bark/audio/${encodeURIComponent(sample.id)}`;

    if (player.sampleId === sample.id && player.status === "playing") {
      audio.pause();
      setPlayer({ sampleId: sample.id, src: player.src, status: "idle", error: "" });
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Some mobile browsers reject currentTime before metadata is loaded.
    }

    setPlayer({ sampleId: sample.id, src: "", status: "loading", error: "" });

    try {
      // Revoke previous blob URL
      if (playerObjectUrlRef.current) {
        URL.revokeObjectURL(playerObjectUrlRef.current);
        playerObjectUrlRef.current = "";
      }

      async function waitForAudioReady() {
        await new Promise((resolve, reject) => {
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(audio.error || new Error("载入失败"));
          };
          const cleanup = () => {
            audio.removeEventListener("canplaythrough", onReady);
            audio.removeEventListener("canplay", onReady);
            audio.removeEventListener("error", onError);
            clearTimeout(timeout);
          };
          if (audio.readyState >= 2) {
            resolve();
            return;
          }
          audio.addEventListener("canplaythrough", onReady, { once: true });
          audio.addEventListener("canplay", onReady, { once: true });
          audio.addEventListener("error", onError, { once: true });
          const timeout = setTimeout(() => {
            cleanup();
            resolve();
          }, 4000);
        });
      }

      async function loadAndPlay(source) {
        audio.src = source;
        audio.load();
        await waitForAudioReady();
        const playPromise = audio.play();
        if (playPromise?.catch) await playPromise;
      }

      async function createBlobUrl() {
        const fetchResponse = await fetch(audioSrc, { credentials: "same-origin" });
        if (!fetchResponse.ok) return "";
        const contentType = fetchResponse.headers.get("content-type") || sample.audioContentType || "";
        const audioBuffer = await fetchResponse.arrayBuffer();
        if (!audioBuffer.byteLength) return "";
        const blob = contentType ? new Blob([audioBuffer], { type: contentType }) : new Blob([audioBuffer]);
        const blobUrl = URL.createObjectURL(blob);
        playerObjectUrlRef.current = blobUrl;
        return blobUrl;
      }

      try {
        // Prefer direct source playback first; Android Chrome is often happier
        // with the native media pipeline than with an app-side fetch+blob hop.
        await loadAndPlay(audioSrc);
      } catch (directError) {
        const blobUrl = await createBlobUrl().catch(() => "");
        if (!blobUrl) throw directError;
        await loadAndPlay(blobUrl);
      }

      setPlayer({ sampleId: sample.id, src: audioSrc, status: "playing", error: "" });
    } catch (playError) {
      const message = getAudioErrorText(audio, playError);
      const diagnostic = await getAudioRouteDiagnostic(audioSrc);
      setPlayer({
        sampleId: sample.id,
        src: audio.src || audioSrc,
        status: audio.error ? "error" : "ready",
        error: [message || playError?.message || "音频片段读取失败。", diagnostic].filter(Boolean).join(" ")
      });
    }
  }

  const statusText = listening ? (savingSample ? "保存片段中" : "低功耗监听中") : permissionState;
  const topSample = lastSample || samples[0];

  return (
    <section className="singleColumn barkWorkspace">
      <div className="pageHeader barkHeader compact">
        <div>
          <h2>声音库</h2>
          <p>降误报优先，连续叫声合并成段，再按声学形态细分。</p>
        </div>
        <button className={listening ? "miniDangerButton" : "primaryButton"} type="button" onClick={listening ? stopListening : startListening}>
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
          {listening ? "停止" : "开始"}
        </button>
      </div>

      <section className="barkStatusBar">
        <div>
          <Activity size={16} />
          <strong>{statusText}</strong>
          <span>{wakeLockActive ? "屏幕唤醒保护" : "锁屏后由浏览器决定"}</span>
        </div>
        <label>
          灵敏度
          <select value={sensitivity} onChange={(event) => setSensitivity(event.target.value)} disabled={listening}>
            {Object.entries(sensitivityConfig).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
      </section>

      <div className="barkMetricGrid">
        <MetricChip label="今日片段" value={summary.today} />
        <MetricChip label="叫声段" value={summary.sessions} />
        <MetricChip label="疑似狗叫" value={summary.total} />
        <MetricChip label="待确认" value={summary.pending} />
        <MetricChip label="已归类" value={summary.clustered} />
      </div>

      {activeSection === "home" ? (
        <div className="sectionMenuGrid barkHomeGrid">
          <BarkSectionCard
            icon={Mic}
            title="实时监听"
            subtitle="启动麦克风、查看分数和最近样本"
            meta={statusText}
            onClick={() => setActiveSection("listen")}
          />
          <BarkSectionCard
            icon={AudioWaveform}
            title="叫声段与声纹"
            subtitle="按日期浏览，可播放、标注和看详情"
            meta={`${summary.sessions} 段`}
            onClick={() => setActiveSection("sessions")}
          />
          <BarkSectionCard
            icon={FlaskConical}
            title="本地训练"
            subtitle="拉取云端数据、本地标注训练、再推送"
            meta={`${localTraining?.summary?.sampleCount || 0} 样本`}
            onClick={() => setActiveSection("training")}
          />
          <BarkSectionCard
            icon={Brain}
            title="细分分析"
            subtitle="查看声音组、画像和时间分布"
            meta={`${analysis.sessionStats.total || 0} 段`}
            onClick={() => setActiveSection("analysis")}
          />
        </div>
      ) : (
        <BarkSubpageTop
          title={{
            listen: "实时监听",
            sessions: "叫声段与声纹",
            training: "本地训练",
            analysis: "细分分析"
          }[activeSection]}
          subtitle={{
            listen: "只看采集与最近样本",
            sessions: "按日期切换，点击详情再展开分析",
            training: "本地流程独立一页处理",
            analysis: "统计和画像单独查看"
          }[activeSection]}
          onBack={() => setActiveSection("home")}
        />
      )}

      <div className={`barkPlayerDock ${player.sampleId ? "active" : ""}`}>
        <div>
          <strong>{activePlayerSample ? formatDateTime(activePlayerSample.capturedAt) : "选择一个片段"}</strong>
          <span>{player.status === "playing" ? "播放中" : player.status === "loading" ? "载入中" : player.status === "error" ? "播放失败" : "可手动播放"}</span>
        </div>
        {player.src ? <a href={player.src} target="_blank" rel="noreferrer">打开原音频</a> : null}
        <audio
          ref={audioRef}
          className="barkNativePlayer"
          controls
          preload="auto"
          playsInline
          onCanPlay={() => setPlayer((current) => (current.sampleId && current.status !== "playing" ? { ...current, status: "ready" } : current))}
          onPlay={() => setPlayer((current) => (current.sampleId ? { ...current, status: "playing" } : current))}
          onPause={() => setPlayer((current) => (current.sampleId ? { ...current, status: "idle" } : current))}
          onEnded={() => setPlayer((current) => ({ ...current, status: "idle", error: "" }))}
          onError={() => setPlayer((current) => (current.sampleId ? { ...current, status: "error", error: getAudioErrorText(audioRef.current) } : current))}
        />
      </div>
      {player.error ? <p className="formError">{player.error}</p> : null}

      {activeSection !== "home" ? (
      <div className={`barkLibraryLayout barkView-${activeSection}`}>
        {activeSection === "listen" ? (
        <section className="contentPanel barkMonitorPanel dense">
          <div className="sectionHeading">
            <p>实时检测</p>
            <span>{meydaReady ? "Meyda 特征已启用" : "基础特征"} · {mediaRecorderReady ? "可保存音频" : "仅特征"}</span>
          </div>
          <div className="barkMeterGrid dense">
            <div className="barkMeter">
              <span>环境响度</span>
              <strong>{Math.round(level * 100)}%</strong>
              <i style={{ width: `${Math.round(clamp(level * 3) * 100)}%` }} />
            </div>
            <div className="barkMeter">
              <span>狗叫分数</span>
              <strong>{Math.round(barkScore * 100)}%</strong>
              <i style={{ width: `${Math.round(barkScore * 100)}%` }} />
            </div>
            <div className="barkMeter">
              <span>噪声基线</span>
              <strong>{Math.round(noiseLevel * 100)}%</strong>
              <i style={{ width: `${Math.round(clamp(noiseLevel * 4) * 100)}%` }} />
            </div>
          </div>
          {error ? <p className="formError">{error}</p> : null}
          <div className="barkGuardrail">
            <ShieldCheck size={16} />
            <span>低频采样降低发热；明显爆发声优先收集。已过滤 {filterStats.humanVoice} 帧人声倾向、{filterStats.steadyNoise} 帧稳定噪音；连续叫声合并 {filterStats.merged} 次。</span>
          </div>

          <div className="barkLatestBlock">
            <div className="sectionHeading">
              <p>最近样本</p>
              <span>{topSample ? formatDateTime(topSample.capturedAt) : "暂无"}</span>
            </div>
            {topSample ? (
              <SampleCard sample={topSample} onLabel={labelSample} onPlay={playSample} player={player} labelOptions={labelOptions} />
            ) : (
              <p className="mutedText">开始监听后，候选狗叫会自动出现在这里。</p>
            )}
          </div>
        </section>
        ) : null}

        {activeSection === "sessions" ? (
        <section className="contentPanel barkLibraryPanel">
          <div className="sectionHeading">
            <p>自动聚类</p>
            <button className="miniActionButton" type="button" onClick={rebuildClusters} disabled={rebuildingClusters}>
              <RefreshCw size={14} />
              {rebuildingClusters ? "重算中" : "重算"}
            </button>
          </div>
          <div className="barkLibraryHints">
            <span><Database size={14} /> {samples.length} 条样本</span>
            <span><Brain size={14} /> {clusters.length} 个声音组</span>
            <span><Volume2 size={14} /> 单播放器回放</span>
          </div>
          <BarkLearningPanel
            model={model}
            summary={summary}
            clusters={clusters}
            onRebuild={rebuildClusters}
            rebuilding={rebuildingClusters}
          />
          <BarkLabelManager labels={labelOptions} onCreate={createProductionLabel} onDelete={deleteProductionLabel} compact />
          <div className="barkClusterList">
            <CompactSessionList
              dateGroups={sessionDateGroups}
              selectedDateKey={selectedSessionDateKey}
              onSelectDateKey={setSelectedSessionDateKey}
              onOpenDetail={setDetailSessionId}
              onPlay={playSample}
              player={player}
              labelOptions={labelOptions}
            />
          </div>
          {groupedClusters.length ? (
            <details className="barkClusterArchive">
              <summary>按声音组查看 {groupedClusters.length} 组</summary>
              <div className="barkSampleStack">
                {groupedClusters.map(({ cluster, samples: clusterSamples }) => (
                  <ClusterCard
                    cluster={cluster}
                    samples={clusterSamples}
                    key={cluster.id}
                    onLabel={labelSample}
                    onPlay={playSample}
                    player={player}
                    clusterStat={clusterStatsById.get(cluster.id)}
                    labelOptions={labelOptions}
                  />
                ))}
              </div>
            </details>
          ) : null}
          <SessionDetailPopup
            group={detailSessionGroup}
            onClose={() => setDetailSessionId("")}
            onLabel={labelSample}
            onPlay={playSample}
            player={player}
            labelOptions={labelOptions}
          />
        </section>
        ) : null}
        {activeSection === "training" ? (
          <LocalTrainingPanel
            state={localTraining}
            runningAction={runningLocalAction}
            onAction={runLocalAction}
            onLabel={labelLocalSample}
            onPlay={playSample}
            player={player}
            labelOptions={localTraining?.labelOptions || labelOptions}
          />
        ) : null}
        {activeSection === "analysis" ? <AnalysisPanel analysis={analysis} sessions={sessions} /> : null}
      </div>
      ) : null}
    </section>
  );
}
