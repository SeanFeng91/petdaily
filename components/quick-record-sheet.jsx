"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Popup, Selector } from "antd-mobile";
import { Camera, ChevronDown, ImagePlus, Trash2, Upload, X } from "lucide-react";
import { compressImageFile } from "@/components/image-file";

function localDateTimeValue(value = new Date()) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function createDefaultPreset() {
  return { id: "default-event", label: "事件", note: "", mode: "point" };
}

export default function QuickRecordSheet({
  open,
  petId,
  eventPresets = [],
  selectedPresetId,
  onClose,
  onCreate
}) {
  const cameraInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const presetOptions = useMemo(() => {
    const configured = eventPresets
      .filter((item) => item?.label?.trim())
      .map((item) => ({
        id: item.id,
        label: item.label.trim(),
        note: item.note || "",
        mode: item.mode === "range" ? "range" : "point"
      }));

    return configured.length ? configured : [createDefaultPreset()];
  }, [eventPresets]);
  const [activePresetId, setActivePresetId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [happenedAt, setHappenedAt] = useState(localDateTimeValue());
  const [rangeMode, setRangeMode] = useState(false);
  const [endedAt, setEndedAt] = useState("");
  const [photoExpanded, setPhotoExpanded] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const applyPreset = useCallback((preset) => {
    if (!preset) return;
    const now = new Date();
    const nowValue = localDateTimeValue(now);
    const nextRangeMode = preset.mode === "range";

    setActivePresetId(preset.id);
    setTitle(preset.label || "事件");
    setNote(preset.note || "");
    setRangeMode(nextRangeMode);
    setHappenedAt(nextRangeMode ? localDateTimeValue(new Date(now.getTime() - 30 * 60000)) : nowValue);
    setEndedAt(nextRangeMode ? nowValue : "");
    setFormError("");
  }, []);

  useEffect(() => {
    if (!open || !presetOptions.length) return;
    setPhotoUrl("");
    setPhotoError("");
    setPhotoExpanded(false);
    const nextPreset = presetOptions.find((preset) => preset.id === selectedPresetId) || presetOptions[0];
    applyPreset(nextPreset);
  }, [applyPreset, open, presetOptions, selectedPresetId]);

  useEffect(() => {
    if (photoUrl) setPhotoExpanded(true);
  }, [photoUrl]);

  useEffect(() => {
    if (rangeMode) return;
    setEndedAt("");
  }, [rangeMode]);

  if (!open) return null;

  async function selectFile(file) {
    if (!file) return;
    setPhotoProcessing(true);
    setPhotoError("");
    setPhotoExpanded(true);
    try {
      const dataUrl = await compressImageFile(file);
      setPhotoUrl(dataUrl);
    } catch (error) {
      setPhotoError(error.message || "照片处理失败");
    } finally {
      setPhotoProcessing(false);
    }
  }

  function clearPhoto() {
    setPhotoUrl("");
    setPhotoError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const startAt = new Date(happenedAt);
      if (!Number.isFinite(startAt.getTime())) {
        setFormError("开始时间格式不正确。");
        return;
      }

      let metadata = undefined;
      if (rangeMode) {
        const endAt = new Date(endedAt);
        if (!Number.isFinite(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
          setFormError("结束时间需要晚于开始时间。");
          return;
        }
        metadata = {
          endedAt: endAt.toISOString(),
          durationMs: Math.max(60000, endAt.getTime() - startAt.getTime())
        };
      }

      await onCreate({
        petId,
        type: "NOTE",
        title: title.trim() || presetOptions.find((preset) => preset.id === activePresetId)?.label || "事件",
        note: note.trim(),
        amount: "",
        unit: "",
        photoUrl: photoUrl.trim(),
        happenedAt: startAt.toISOString(),
        metadata
      });

      setPhotoUrl("");
      setPhotoError("");
      setPhotoExpanded(false);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popup
      visible={open}
      onMaskClick={onClose}
      onClose={onClose}
      position="bottom"
      closeOnSwipe
      bodyClassName="quickSheetPopup"
    >
      <section className="quickSheet" aria-label="快速记录">
        <div className="sheetHeader">
          <div>
            <p>新增事件</p>
            <span>先选事件，再确认时间和备注。</span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="recordForm compactRecordForm">
          <input
            ref={cameraInputRef}
            className="hiddenFileInput"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <input
            ref={albumInputRef}
            className="hiddenFileInput"
            type="file"
            accept="image/*"
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          <Selector
            className="quickTypeSelector eventPresetSelector"
            value={[activePresetId]}
            columns={4}
            showCheckMark={false}
            onChange={(value) => {
              const nextPreset = presetOptions.find((preset) => preset.id === value[0]);
              applyPreset(nextPreset);
            }}
            options={presetOptions.map((preset) => ({
              value: preset.id,
              label: <span className="quickTypeOption quickPresetLabel">{preset.label}</span>
            }))}
          />

          <label>
            事件名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="比如 晚餐 / 尿尿 / 训练" />
          </label>

          <Selector
            className="quickTypeSelector rangeModeSelector"
            value={[rangeMode ? "range" : "point"]}
            columns={2}
            showCheckMark={false}
            onChange={(value) => {
              if (!value[0]) return;
              const nextRangeMode = value[0] === "range";
              setRangeMode(nextRangeMode);
              if (nextRangeMode && !endedAt) {
                setEndedAt(localDateTimeValue());
              }
            }}
            options={[
              { value: "point", label: "单点事件" },
              { value: "range", label: "持续时段" }
            ]}
          />

          {rangeMode ? (
            <div className="formGridTwo rangeGrid">
              <label>
                开始时间
                <input type="datetime-local" value={happenedAt} onChange={(event) => setHappenedAt(event.target.value)} />
              </label>
              <label>
                结束时间
                <input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
              </label>
            </div>
          ) : (
            <label>
              发生时间
              <input type="datetime-local" value={happenedAt} onChange={(event) => setHappenedAt(event.target.value)} />
            </label>
          )}

          <label>
            备注
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="可选，比如饭后 20 分钟完成尿尿。"
            />
          </label>

          <section className={`recordPhotoField subtlePhotoField ${photoExpanded ? "expanded" : ""}`}>
            <button
              className="photoFieldToggle"
              type="button"
              onClick={() => setPhotoExpanded((current) => !current)}
              aria-expanded={photoExpanded}
            >
              <span>照片（可选）</span>
              <ChevronDown size={16} />
            </button>

            {photoExpanded ? (
              <div className="photoFieldBody">
                <div className="photoFieldActions">
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={photoProcessing}
                  >
                    <Camera size={16} />
                    拍照
                  </button>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => albumInputRef.current?.click()}
                    disabled={photoProcessing}
                  >
                    <Upload size={16} />
                    相册
                  </button>
                </div>
                {photoUrl ? (
                  <div className="recordPhotoPreview">
                    <img src={photoUrl} alt="待保存记录照片预览" />
                    <button className="miniDangerButton" type="button" onClick={clearPhoto}>
                      <Trash2 size={15} />
                      移除
                    </button>
                  </div>
                ) : null}
                <label>
                  图片 URL
                  <input
                    value={photoUrl}
                    onChange={(event) => {
                      setPhotoUrl(event.target.value);
                      setPhotoError("");
                    }}
                    placeholder="/photos/westie-window.svg"
                  />
                </label>
                {photoProcessing ? (
                  <p className="formHint">
                    <ImagePlus size={14} />
                    正在压缩照片...
                  </p>
                ) : null}
                {photoError ? <p className="formError">{photoError}</p> : null}
              </div>
            ) : null}
          </section>

          {formError ? <p className="formError">{formError}</p> : null}

          <Button className="quickSubmitButton" color="primary" block type="submit" loading={saving}>
            {saving ? "保存中..." : "保存记录"}
          </Button>
        </form>
      </section>
    </Popup>
  );
}
