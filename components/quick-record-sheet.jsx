"use client";

import { useMemo, useState } from "react";
import { Camera, Scale, Utensils, X } from "lucide-react";
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
  const [type, setType] = useState("FOOD");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [happenedAt, setHappenedAt] = useState(localDateTimeValue());
  const [saving, setSaving] = useState(false);

  const selected = EVENT_TYPES[type];
  const defaultTitle = useMemo(() => `${selected?.label || "日常"}记录`, [selected]);

  if (!open) return null;

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

          {type === "PHOTO" ? (
            <label>
              照片路径
              <input value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="/photos/westie-window.svg" />
            </label>
          ) : null}

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
