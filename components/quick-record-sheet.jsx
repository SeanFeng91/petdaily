"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, Scale, Trash2, Upload, Utensils, X } from "lucide-react";
import { compressImageFile } from "@/components/image-file";
import { EVENT_TYPES } from "@/lib/domain";

const quickTypes = [
  { type: "FOOD", icon: Utensils },
  { type: "POTTY", icon: Camera },
  { type: "STOOL", icon: Camera },
  { type: "WEIGHT", icon: Scale },
  { type: "VACCINE", icon: Camera },
  { type: "DEWORM", icon: Camera },
  { type: "PHOTO", icon: Camera },
  { type: "NOTE", icon: Camera }
];

function localDateTimeValue() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export default function QuickRecordSheet({ open, petId, onClose, onCreate }) {
  const cameraInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const [type, setType] = useState("FOOD");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [happenedAt, setHappenedAt] = useState(localDateTimeValue());
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = EVENT_TYPES[type];
  const defaultTitle = useMemo(() => `${selected?.label || "日常"}记录`, [selected]);

  if (!open) return null;

  async function selectFile(file) {
    if (!file) return;
    setPhotoProcessing(true);
    setPhotoError("");
    try {
      const dataUrl = await compressImageFile(file);
      setPhotoUrl(dataUrl);
      if (!title && type === "PHOTO") {
        setTitle("手机拍摄记录");
      }
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
    try {
      await onCreate({
        petId,
        type,
        title: title || defaultTitle,
        note,
        amount,
        unit: selected?.unit || "",
        photoUrl,
        happenedAt: new Date(happenedAt).toISOString()
      });
      setTitle("");
      setNote("");
      setAmount("");
      setPhotoUrl("");
      setPhotoError("");
      setHappenedAt(localDateTimeValue());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheetBackdrop" role="presentation">
      <section className="quickSheet" aria-label="快速记录">
        <div className="sheetHeader">
          <div>
            <p>快速记录</p>
            <span>把刚发生的事情放进时间日记</span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="recordForm">
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

          <div className="typeGrid">
            {quickTypes.map(({ type: itemType, icon: Icon }) => (
              <button
                className={`typeButton ${type === itemType ? "selected" : ""}`}
                key={itemType}
                type="button"
                onClick={() => setType(itemType)}
              >
                <Icon size={17} />
                <span>{EVENT_TYPES[itemType].label}</span>
              </button>
            ))}
          </div>

          <label>
            标题
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={defaultTitle} />
          </label>

          <div className="formGridTwo">
            <label>
              数值
              <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={selected?.unit ? `如 45 ${selected.unit}` : "可选"} inputMode="decimal" />
            </label>
            <label>
              时间
              <input type="datetime-local" value={happenedAt} onChange={(event) => setHappenedAt(event.target.value)} />
            </label>
          </div>

          <div className="recordPhotoField">
            <div className="photoFieldTopline">
              <span>照片（可选）</span>
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

          <label>
            备注
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：饭后 20 分钟完成尿尿，奖励及时。" />
          </label>

          <button className="primaryButton full" type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存记录"}
          </button>
        </form>
      </section>
    </div>
  );
}
