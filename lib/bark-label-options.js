export const DEFAULT_BARK_LABEL_OPTIONS = [
  { id: "outside", label: "想出去", builtIn: true },
  { id: "food", label: "想吃", builtIn: true },
  { id: "bored", label: "无聊", builtIn: true },
  { id: "attention", label: "关注", builtIn: true },
  { id: "fear", label: "警觉", builtIn: true },
  { id: "unknown", label: "不确定", builtIn: true }
];

export function normalizeBarkLabelId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function normalizeBarkLabelOption(option) {
  if (!option) return null;
  const id = normalizeBarkLabelId(option.id || option.label);
  const label = String(option.label || option.id || "").trim().slice(0, 16);
  if (!id || !label) return null;
  return {
    id,
    label,
    builtIn: Boolean(option.builtIn)
  };
}

export function mergeBarkLabelOptions(...groups) {
  const byId = new Map();
  for (const option of DEFAULT_BARK_LABEL_OPTIONS) {
    byId.set(option.id, option);
  }
  for (const group of groups) {
    for (const option of group || []) {
      const normalized = normalizeBarkLabelOption(option);
      if (!normalized) continue;
      byId.set(normalized.id, {
        ...byId.get(normalized.id),
        ...normalized,
        builtIn: Boolean(byId.get(normalized.id)?.builtIn || normalized.builtIn)
      });
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.label.localeCompare(b.label, "zh-CN"));
}
