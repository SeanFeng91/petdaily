"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioWaveform,
  Brain,
  CheckCircle2,
  Database,
  Mic,
  MicOff,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Volume2,
  XCircle
} from "lucide-react";
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
const sensitivityConfig = BARK_SENSITIVITY_CONFIG;

const reasonOptions = [
  { id: "outside", label: "想出去" },
  { id: "food", label: "想吃" },
  { id: "bored", label: "无聊" },
  { id: "attention", label: "关注" },
  { id: "fear", label: "警觉" },
  { id: "unknown", label: "不确定" }
];

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

function getReasonLabel(reason) {
  if (reason === "false_positive" || reason === "false-positive") return "不是狗叫";
  return reasonOptions.find((item) => item.id === reason)?.label || reason || "";
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
  const code = audio?.error?.code;
  if (code === 2) return "音频网络加载失败，请稍后重试。";
  if (code === 3) return "音频解码失败，可能是片段文件不完整。";
  if (code === 4) return "浏览器不支持这段音频格式。";
  return "播放失败，请点下方原生播放器或重新采集一段。";
}

async function getAudioRouteDiagnostic(audioSrc) {
  if (!audioSrc?.startsWith("/api/")) return "";
  try {
    const response = await fetch(audioSrc, {
      headers: { Range: "bytes=0-0" },
      cache: "no-store"
    });
    if (response.status === 206 || response.ok) return "音频接口可读取，当前更像是浏览器解码或格式兼容问题。";
    if (response.status === 404) return "音频索引存在但文件对象没有找到，需要重新采集或检查 R2 同步。";
    if (response.status === 422) return "这条记录保存的是空音频，只能用于声纹分析。";
    return `音频接口返回 ${response.status}，请稍后重试或重新采集。`;
  } catch {
    return "音频接口探测失败，可能是网络或登录状态中断。";
  }
}

function RecommendationBadge({ sample }) {
  if (sample.modelSuggestion) {
    return (
      <div className="barkModelBadge strong">
        <Brain size={13} />
        <span>学习推荐 {getReasonLabel(sample.modelSuggestion)} · {Math.round((sample.modelConfidence || 0) * 100)}%</span>
      </div>
    );
  }
  if (sample.ruleSuggestion) {
    return (
      <div className="barkModelBadge">
        <Brain size={13} />
        <span>规则猜测 {getReasonLabel(sample.ruleSuggestion)} · {Math.round((sample.ruleConfidence || 0) * 100)}%</span>
      </div>
    );
  }
  return null;
}

function SampleCard({ sample, compact = false, onLabel, onPlay, player }) {
  const score = Math.round((sample.barkScore || 0) * 100);
  const statusText = sample.status === "confirmed" ? "已确认" : sample.status === "false_positive" ? "误报" : "待归类";
  const reasonLabel = getReasonLabel(sample.reason);
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
      <VoiceprintDetails sample={sample} compact={compact} />
      <RecommendationBadge sample={sample} />
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
          {reasonOptions.map((option) => (
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

function ClusterCard({ cluster, samples, onLabel, onPlay, player, clusterStat }) {
  const latest = samples[0];
  const pendingCount = samples.filter((sample) => sample.status === "candidate").length;
  const profile = clusterStat?.profile || getBarkAcousticProfile(latest?.features || {});
  const label = cluster.reason ? reasonOptions.find((item) => item.id === cluster.reason)?.label || cluster.reason : profile.label || "未命名声音";

  return (
    <section className="barkClusterCard">
      <div className="barkClusterHeader">
        <div>
          <strong>{label}</strong>
          <span>{samples.length} 条样本 · {pendingCount} 条待确认 · {profile.label}</span>
        </div>
        <b>{latest ? Math.round((latest.barkScore || 0) * 100) : 0}%</b>
      </div>
      {latest ? <SampleCard sample={latest} compact onLabel={onLabel} onPlay={onPlay} player={player} /> : null}
      <div className="barkQuickLabels clusterLabels">
        {reasonOptions.map((option) => (
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
              <SampleCard sample={sample} key={sample.id} compact onLabel={onLabel} onPlay={onPlay} player={player} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SessionCard({ session, samples, onLabel, onPlay, player }) {
  const sortedSamples = [...samples].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const displaySamples = [...samples].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  const representative =
    samples.find((sample) => sample.id === session.representativeSampleId) ||
    [...samples].sort((a, b) => Number(b.barkScore || 0) - Number(a.barkScore || 0))[0];
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
        {suggestion ? <strong>{suggestionPrefix} {getReasonLabel(suggestion)} · {Math.round((confidence || 0) * 100)}%</strong> : <em>模型待学习</em>}
      </div>
      {representative ? (
        <SampleCard sample={representative} compact onLabel={onLabel} onPlay={onPlay} player={player} />
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
                <SampleCard sample={sample} key={sample.id} compact onLabel={onLabel} onPlay={onPlay} player={player} />
              ))}
          </div>
        </details>
      ) : null}
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
  const [sensitivity, setSensitivity] = useState("low");
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
  const [savingSample, setSavingSample] = useState(false);
  const [rebuildingClusters, setRebuildingClusters] = useState(false);
  const [filterStats, setFilterStats] = useState({ humanVoice: 0, steadyNoise: 0, merged: 0, clipQuota: 0 });
  const [player, setPlayer] = useState({ sampleId: null, src: "", status: "idle", error: "" });
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [meydaReady, setMeydaReady] = useState(false);
  const [mediaRecorderReady, setMediaRecorderReady] = useState(false);

  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const wakeLockRef = useRef(null);
  const detectorRef = useRef({ activeFrames: 0, lastDetectedAt: 0 });
  const frequencyRef = useRef(null);
  const timeByteRef = useRef(null);
  const timeFloatRef = useRef(null);
  const previousFrequencyRef = useRef(null);
  const noiseBaselineRef = useRef(0.025);
  const timelineEventsRef = useRef(timelineEvents);
  const sensitivityRef = useRef(sensitivity);
  const meydaRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const playerObjectUrlRef = useRef("");
  const rollingChunksRef = useRef([]);
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

  useEffect(() => {
    timelineEventsRef.current = timelineEvents;
  }, [timelineEvents]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    refreshLibrary().catch((loadError) => setError(loadError?.message || "声音库加载失败。"));
  }, [refreshLibrary]);

  useEffect(() => {
    return () => {
      if (playerObjectUrlRef.current) URL.revokeObjectURL(playerObjectUrlRef.current);
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data?.size) return;
        rollingChunksRef.current = [...rollingChunksRef.current, event.data].slice(-MAX_ROLLING_CHUNKS);
        if (captureRef.current) captureRef.current.chunks.push(event.data);
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
      detectorRef.current = { activeFrames: 0, lastDetectedAt: Date.now() - sensitivityConfig[sensitivityRef.current].cooldownMs };
      sessionStateRef.current = getInitialBarkSessionState();
      filterCountersRef.current = { humanVoice: 0, steadyNoise: 0, merged: 0, clipQuota: 0 };
      setFilterStats(filterCountersRef.current);
      noiseBaselineRef.current = 0.025;

      startRecorder(stream);
      setListening(true);
      setPermissionState("正在前台收集");
      requestWakeLock();
      rafRef.current = requestAnimationFrame(analyzeFrame);
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
      waveform: calculateWaveform(timeFloat)
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
          resolve(session.chunks.length ? new Blob(session.chunks, { type }) : null);
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
      const payloadFeatures = {
        ...features,
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

  function analyzeFrame() {
    const features = extractFeatures();
    if (!features) return;

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
    if (now - lastUiUpdateRef.current > 160) {
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

    rafRef.current = requestAnimationFrame(analyzeFrame);
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

  async function playSample(sample) {
    const audio = audioRef.current;
    if (!audio || !sample?.id) return;
    if (sample.audioSizeBytes != null && Number(sample.audioSizeBytes) <= 0 && !sample.audioUrl && !sample.audioObjectKey) {
      setPlayer({ sampleId: sample.id, src: "", status: "error", error: "这段样本没有保存到可播放音频，只能查看声纹。" });
      return;
    }
    const audioSrc = sample.audioUrl?.startsWith("/api/")
      ? sample.audioUrl
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
      if (playerObjectUrlRef.current) URL.revokeObjectURL(playerObjectUrlRef.current);
      playerObjectUrlRef.current = "";
      audio.src = audioSrc;
      audio.load();

      const playPromise = audio.play();
      if (!playPromise?.catch) {
        setPlayer({ sampleId: sample.id, src: audioSrc, status: "playing", error: "" });
        return;
      }

      await playPromise;
      setPlayer({ sampleId: sample.id, src: audioSrc, status: "playing", error: "" });
    } catch (playError) {
      const message = getAudioErrorText(audio, playError);
      const diagnostic = await getAudioRouteDiagnostic(audioSrc);
      setPlayer({
        sampleId: sample.id,
        src: audioSrc,
        status: audio.error ? "error" : "ready",
        error: [message || playError?.message || "音频片段读取失败。", diagnostic].filter(Boolean).join(" ")
      });
    }
  }

  const statusText = listening ? (savingSample ? "保存片段中" : "前台收集中") : permissionState;
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
          <span>{wakeLockActive ? "屏幕保持唤醒" : "前台监听"}</span>
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

      <div className="barkLibraryLayout">
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
            <span>已过滤 {filterStats.humanVoice} 帧人声倾向、{filterStats.steadyNoise} 帧稳定噪音；连续叫声合并 {filterStats.merged} 次。</span>
          </div>

          <div className="barkLatestBlock">
            <div className="sectionHeading">
              <p>最近样本</p>
              <span>{topSample ? formatDateTime(topSample.capturedAt) : "暂无"}</span>
            </div>
            {topSample ? (
              <SampleCard sample={topSample} onLabel={labelSample} onPlay={playSample} player={player} />
            ) : (
              <p className="mutedText">开始监听后，候选狗叫会自动出现在这里。</p>
            )}
          </div>
        </section>

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
              preload="metadata"
              onCanPlay={() => setPlayer((current) => (current.sampleId && current.status !== "playing" ? { ...current, status: "ready" } : current))}
              onPlay={() => setPlayer((current) => (current.sampleId ? { ...current, status: "playing" } : current))}
              onPause={() => setPlayer((current) => (current.sampleId ? { ...current, status: "idle" } : current))}
              onEnded={() => setPlayer((current) => ({ ...current, status: "idle", error: "" }))}
              onError={() => setPlayer((current) => (current.sampleId ? { ...current, status: "error", error: getAudioErrorText(audioRef.current) } : current))}
            />
          </div>
          {player.error ? <p className="formError">{player.error}</p> : null}
          <div className="barkClusterList">
            {groupedSessions.length ? (
              groupedSessions.map(({ session, samples: sessionSamples }) => (
                <SessionCard
                  session={session}
                  samples={sessionSamples}
                  key={session.id}
                  onLabel={labelSample}
                  onPlay={playSample}
                  player={player}
                />
              ))
            ) : (
              <p className="mutedText">还没有声音样本。建议先用“降误报”监听一段时间，再回来看声纹段。</p>
            )}
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
                  />
                ))}
              </div>
            </details>
          ) : null}
        </section>
        <AnalysisPanel analysis={analysis} sessions={sessions} />
      </div>
    </section>
  );
}
