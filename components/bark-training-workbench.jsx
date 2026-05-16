"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Brain, Database, Download, FlaskConical, PlayCircle, RefreshCw, Tag, UploadCloud } from "lucide-react";
import BarkLabelManager from "@/components/bark-label-manager";
import { DEFAULT_BARK_LABEL_OPTIONS, mergeBarkLabelOptions } from "@/lib/bark-label-options";

const fallbackReasonOptions = DEFAULT_BARK_LABEL_OPTIONS;

const reasonLabelMap = {
  outside: "想出去",
  food: "想吃",
  bored: "无聊",
  attention: "关注",
  fear: "警觉",
  false_positive: "不是狗叫",
  "false-positive": "不是狗叫",
  unlabeled: "未标注"
};

function getReasonLabel(reason) {
  if (String(reason || "").startsWith("acoustic_")) {
    return `声纹组 ${String(reason).split("_")[1] || ""}`.trim();
  }
  return reasonLabelMap[reason] || reason || "未标注";
}

function formatDateTime(value) {
  if (!value) return "尚未执行";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Metric({ label, value, hint }) {
  return (
    <div className="trainingMetric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

function StatusPill({ status, children }) {
  return <span className={`trainingPill ${status === "done" || status === "trained" ? "done" : "blocked"}`}>{children}</span>;
}

function TrainingCurve({ epochs = [] }) {
  const width = 720;
  const height = 210;
  const pad = 26;
  const visible = epochs.length ? epochs : [{ epoch: 1, loss: 1, validationLoss: 1, accuracy: 0, validationAccuracy: 0 }];
  const maxLoss = Math.max(0.2, ...visible.map((item) => Math.max(item.loss || 0, item.validationLoss || 0)));
  const xFor = (index) => pad + (index / Math.max(1, visible.length - 1)) * (width - pad * 2);
  const yLoss = (value) => pad + (1 - Math.min(maxLoss, value || 0) / maxLoss) * (height - pad * 2);
  const yAcc = (value) => pad + (1 - Math.max(0, Math.min(1, value || 0))) * (height - pad * 2);
  const line = (key, yFn) => visible.map((item, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFn(item[key]).toFixed(1)}`).join(" ");

  return (
    <div className="trainingChartSurface">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="训练曲线">
        <path className="chartGrid" d={`M ${pad} ${pad} H ${width - pad} M ${pad} ${height / 2} H ${width - pad} M ${pad} ${height - pad} H ${width - pad}`} />
        <path className="lossLine" d={line("loss", yLoss)} />
        <path className="validationLossLine" d={line("validationLoss", yLoss)} />
        <path className="accuracyLine" d={line("accuracy", yAcc)} />
        <path className="validationAccuracyLine" d={line("validationAccuracy", yAcc)} />
      </svg>
      <div className="chartLegend">
        <span><i className="loss" />loss</span>
        <span><i className="validationLoss" />val loss</span>
        <span><i className="accuracy" />acc</span>
        <span><i className="validationAccuracy" />val acc</span>
      </div>
    </div>
  );
}

function ConfusionMatrix({ matrix = [] }) {
  const max = Math.max(1, ...matrix.flatMap((row) => row.cells?.map((cell) => cell.count || 0) || []));
  if (!matrix.length) return <p className="mutedText">标签不足时不会生成混淆矩阵。</p>;

  return (
    <div className="confusionMatrix" style={{ "--matrix-count": matrix.length }}>
      <span />
      {matrix.map((row) => <b key={`head-${row.actual}`}>{getReasonLabel(row.actual)}</b>)}
      {matrix.map((row) => (
        <div className="matrixRow" key={row.actual}>
          <b>{getReasonLabel(row.actual)}</b>
          {row.cells.map((cell) => (
            <span
              key={`${row.actual}-${cell.predicted}`}
              style={{ "--heat": Math.max(0.08, (cell.count || 0) / max) }}
              title={`${getReasonLabel(row.actual)} -> ${getReasonLabel(cell.predicted)}: ${cell.count}`}
            >
              {cell.count}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function LabelBars({ rows = [] }) {
  const max = Math.max(1, ...rows.map((row) => row.count || 0));
  return (
    <div className="trainingBars">
      {rows.length ? rows.map((row) => (
        <div className="trainingBarRow" key={row.label || row.reason || row.source}>
          <span>{getReasonLabel(row.label || row.reason || row.source)}</span>
          <div><i style={{ width: `${Math.max(6, ((row.count || 0) / max) * 100)}%` }} /></div>
          <b>{row.count}</b>
        </div>
      )) : <p className="mutedText">暂无标签。</p>}
    </div>
  );
}

export default function BarkTrainingWorkbench() {
  const [state, setState] = useState(null);
  const [labelOptions, setLabelOptions] = useState(fallbackReasonOptions);
  const [error, setError] = useState("");
  const [runningAction, setRunningAction] = useState("");
  const audioRef = useRef(null);

  async function refresh() {
    const response = await fetch("/api/bark/training/local");
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || "本地训练数据读取失败。");
    }
    const result = await response.json();
    setState(result);
    setLabelOptions(mergeBarkLabelOptions(result.labelOptions || []));
  }

  useEffect(() => {
    refresh().catch((loadError) => setError(loadError.message || "本地训练数据读取失败。"));
  }, []);

  async function runAction(action) {
    setError("");
    setRunningAction(action);
    try {
      const response = await fetch("/api/bark/training/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, petId: state?.petId || null })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "训练动作失败。");
      }
      const result = await response.json();
      setState(result.state || null);
      setLabelOptions(mergeBarkLabelOptions(result.state?.labelOptions || []));
    } catch (actionError) {
      setError(actionError.message || "训练动作失败。");
    } finally {
      setRunningAction("");
    }
  }

  async function labelSample(sample, reason) {
    setError("");
    const response = await fetch("/api/bark/training/local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        petId: state?.petId,
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
    setState(result);
    setLabelOptions(mergeBarkLabelOptions(result.labelOptions || []));
  }

  async function createLabel(label) {
    const response = await fetch("/api/bark/training/local/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.message || "本地标签创建失败。");
      return;
    }
    const result = await response.json();
    setLabelOptions(mergeBarkLabelOptions(result.labels || []));
    await refresh();
  }

  async function deleteLabel(id) {
    const response = await fetch("/api/bark/training/local/labels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.message || "本地标签删除失败。");
      return;
    }
    const result = await response.json();
    setLabelOptions(mergeBarkLabelOptions(result.labels || []));
    await refresh();
  }

  function playSample(sample) {
    if (!audioRef.current || !sample?.localAudioUrl) return;
    audioRef.current.src = sample.localAudioUrl;
    audioRef.current.play().catch((playError) => setError(playError.message || "音频播放失败。"));
  }

  const report = state?.trainingReport || null;
  const deep = report?.deepTraining || {};
  const latestEpoch = deep.epochs?.[deep.epochs.length - 1] || null;
  const activeLabelOptions = state?.labelOptions?.length ? state.labelOptions : labelOptions;
  const pendingClusters = useMemo(() => (state?.clusters || []).filter((cluster) => cluster.pendingCount > 0).slice(0, 8), [state]);

  return (
    <main className="trainingPage">
      <section className="trainingHero">
        <div>
          <span className="trainingEyebrow">PetDaily Offline Bark Lab</span>
          <h1>本地训练监控</h1>
          <p>这里专门处理从生产拉下来的声音数据，允许更重、更久的本地训练；训练报告和候选标签不直接耦合主 App 交互。</p>
        </div>
        <div className="trainingActions">
          <button className="secondaryButton" type="button" onClick={() => runAction("download")} disabled={Boolean(runningAction)}>
            <Download size={15} />{runningAction === "download" ? "同步中" : "增量拉取"}
          </button>
          <button className="primaryButton" type="button" onClick={() => runAction("train")} disabled={Boolean(runningAction)}>
            <FlaskConical size={16} />{runningAction === "train" ? "训练中" : "本地训练"}
          </button>
          <button className="secondaryButton" type="button" onClick={() => runAction("push")} disabled={Boolean(runningAction)}>
            <UploadCloud size={15} />{runningAction === "push" ? "推送中" : "推送轻量模型"}
          </button>
          <button className="miniActionButton" type="button" onClick={() => refresh().catch((refreshError) => setError(refreshError.message))}>
            <RefreshCw size={14} />刷新
          </button>
        </div>
      </section>

      {error ? <p className="formError">{error}</p> : null}

      <section className="trainingMetrics">
        <Metric label="本地样本" value={state?.summary?.sampleCount || 0} hint={`${state?.summary?.audioDownloaded || 0} 段音频`} />
        <Metric label="人工标签" value={report?.summary?.manualLabelCount || state?.summary?.labeledSampleCount || 0} hint="你校准后的可信标签" />
        <Metric label="自动候选" value={report?.summary?.pseudoLabelCount || 0} hint="规则 + 聚类预标注" />
        <Metric label="MLP Epoch" value={report?.summary?.epochCount || 0} hint={`${report?.summary?.hiddenUnits || 0} hidden`} />
        <Metric label="验证准确率" value={latestEpoch ? `${Math.round((latestEpoch.validationAccuracy || 0) * 100)}%` : "0%"} hint="本地研究指标" />
        <Metric label="生产可推" value={report?.summary?.productionPrototypeCount || 0} hint={`${report?.summary?.productionManualSampleCount || 0} 人工样本`} />
      </section>

      <section className="trainingGrid">
        <div className="trainingPanel wide">
          <div className="sectionHeading">
            <p>训练过程</p>
            <span>{report ? `${report.version} · ${formatDateTime(report.generatedAt)}` : "尚未生成训练报告"}</span>
          </div>
          <div className="trainingStageRow">
            {(report?.stages || []).map((stage) => (
              <StatusPill key={stage.key} status={stage.status}>
                {stage.label}<em>{stage.detail}</em>
              </StatusPill>
            ))}
          </div>
          <TrainingCurve epochs={deep.epochs || report?.linearProbe?.epochs || []} />
        </div>

        <div className="trainingPanel">
          <div className="sectionHeading">
            <p>标签来源</p>
            <span>未标注会先自动生成候选</span>
          </div>
          <BarkLabelManager labels={activeLabelOptions} onCreate={createLabel} onDelete={deleteLabel} compact />
          <LabelBars rows={report?.labelCounts || state?.labelDistribution || []} />
          <div className="trainingQualityNote">
            <strong>质量判断</strong>
            <span>声纹组用于加速本地训练；只有人工标签会进入可推生产的轻量模型。</span>
          </div>
        </div>

        <div className="trainingPanel">
          <div className="sectionHeading">
            <p>混淆矩阵</p>
            <span>{deep.status === "trained" ? "本地 MLP 验证集" : deep.reason || "等待训练"}</span>
          </div>
          <ConfusionMatrix matrix={deep.confusionMatrix || []} />
        </div>

        <div className="trainingPanel wide">
          <div className="sectionHeading">
            <p>人工接入队列</p>
            <span>先按聚类校准，一次会写回本地 JSON</span>
          </div>
          <div className="trainingClusterGrid">
            {pendingClusters.length ? pendingClusters.map((cluster) => (
              <article className="trainingClusterCard" key={cluster.id}>
                <div>
                  <strong>{cluster.reason ? getReasonLabel(cluster.reason) : "待校准声音组"}</strong>
                  <span>{cluster.sampleCount} 样本 · 待标 {cluster.pendingCount}</span>
                </div>
                {cluster.representativeSample ? (
                  <button className="miniActionButton" type="button" onClick={() => playSample(cluster.representativeSample)}>
                    <PlayCircle size={14} />播放代表音
                  </button>
                ) : null}
                <div className="trainingLabelButtons">
                  {activeLabelOptions.map((option) => (
                    <button className="secondaryButton" type="button" key={option.id} onClick={() => cluster.representativeSample && labelSample(cluster.representativeSample, option.id)}>
                      <Tag size={13} />{option.label}
                    </button>
                  ))}
                  <button className="miniDangerButton" type="button" onClick={() => cluster.representativeSample && labelSample(cluster.representativeSample, "false-positive")}>
                    不是狗叫
                  </button>
                </div>
              </article>
            )) : <p className="mutedText">没有待校准聚类。可以重新拉取或直接训练。</p>}
          </div>
        </div>

        <div className="trainingPanel wide">
          <div className="sectionHeading">
            <p>自动候选样本</p>
            <span>用于快速浏览模型自己先想的标签</span>
          </div>
          <div className="pseudoLabelTable">
            {(report?.pseudoLabels || []).slice(0, 18).map((sample) => (
              <button type="button" key={sample.id} onClick={() => playSample(sample)}>
                <span>{formatDateTime(sample.capturedAt)}</span>
                <strong>{sample.labelText}</strong>
                <em>{Math.round((sample.confidence || 0) * 100)}%</em>
                <b>{sample.reason}{sample.semanticSuggestionText ? ` · 猜测 ${sample.semanticSuggestionText}` : ""}</b>
              </button>
            ))}
            {report?.pseudoLabels?.length ? null : <p className="mutedText">训练后会展示自动候选标签样本。</p>}
          </div>
        </div>
      </section>

      <audio ref={audioRef} className="trainingAudioDock" controls preload="metadata" />
      <footer className="trainingFooter">
        <span><Database size={14} />读取 `data/bark-sync/`</span>
        <span><Brain size={14} />本地 MLP 不直接推生产</span>
        <span><Activity size={14} />推送按钮只推轻量 prototype artifact</span>
      </footer>
    </main>
  );
}
