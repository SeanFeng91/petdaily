"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export default function BarkLabelManager({ labels = [], onCreate, onDelete, compact = false }) {
  const [draft, setDraft] = useState("");

  async function submit(event) {
    event.preventDefault();
    const label = draft.trim();
    if (!label) return;
    await onCreate?.(label);
    setDraft("");
  }

  return (
    <section className={`barkLabelManager ${compact ? "compact" : ""}`}>
      <div className="sectionHeading compact">
        <p>人工标签</p>
        <span>增删标签不会抹掉历史样本标注</span>
      </div>
      <form className="barkLabelForm" onSubmit={submit}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="新增标签，如 分离焦虑" maxLength={16} />
        <button className="miniActionButton" type="submit">
          <Plus size={13} />
          添加
        </button>
      </form>
      <div className="barkLabelList">
        {labels.map((option) => (
          <span key={option.id}>
            {option.label}
            {!option.builtIn ? (
              <button type="button" onClick={() => onDelete?.(option.id)} aria-label={`删除标签 ${option.label}`}>
                <Trash2 size={12} />
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </section>
  );
}
