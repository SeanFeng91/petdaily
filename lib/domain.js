export const EVENT_TYPES = {
  FOOD: { label: "饮食", unit: "g", tone: "mint" },
  POTTY: { label: "如厕", unit: "次", tone: "sky" },
  STOOL: { label: "排便", unit: "次", tone: "amber" },
  WEIGHT: { label: "体重", unit: "kg", tone: "rose" },
  VACCINE: { label: "疫苗", unit: "", tone: "violet" },
  DEWORM: { label: "驱虫", unit: "", tone: "teal" },
  PHOTO: { label: "照片", unit: "", tone: "pink" },
  BARK: { label: "狗叫", unit: "%", tone: "slate" },
  NOTE: { label: "事件", unit: "", tone: "slate" }
};

export const REMINDER_KINDS = {
  FOOD: "喂食",
  POTTY: "外出如厕",
  VACCINE: "疫苗",
  DEWORM: "驱虫",
  GROOMING: "护理",
  TRAINING: "训练"
};

export const EXPENSE_CATEGORIES = {
  FOOD: "主粮零食",
  MEDICAL: "疫苗医疗",
  DAILY: "日用品",
  TOY: "玩具训练",
  GROOMING: "护理美容"
};

export function getAgeText(birthdayIso, now = new Date()) {
  if (!birthdayIso) return "未设置生日";
  const birthday = new Date(birthdayIso);
  const days = Math.max(1, Math.floor((now - birthday) / 86400000));
  const months = Math.floor(days / 30);
  const weeks = Math.floor((days % 30) / 7);
  if (months <= 0) return `${Math.floor(days / 7)} 周龄`;
  return weeks > 0 ? `${months} 月 ${weeks} 周` : `${months} 月龄`;
}

export function formatCurrency(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(0)}`;
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

export function getLocalCoachSummary({ pet, timelineEvents, weightRecords, reminders }) {
  const today = new Date();
  const since = new Date(today);
  since.setHours(0, 0, 0, 0);

  const todayEvents = timelineEvents.filter((event) => new Date(event.happenedAt) >= since);
  const foodEvents = todayEvents.filter((event) => event.type === "FOOD");
  const pottyEvents = todayEvents.filter((event) => event.type === "POTTY" || event.type === "STOOL");
  const latestWeight = weightRecords.at(-1);
  const previousWeight = weightRecords.at(-2);
  const delta =
    latestWeight && previousWeight
      ? Number((latestWeight.weightKg - previousWeight.weightKg).toFixed(2))
      : null;

  const strengths = [];
  if (foodEvents.length >= 3) strengths.push("今天已经形成多餐记录，适合 3 月龄幼犬的小胃容量。");
  if (pottyEvents.length >= 3) strengths.push("如厕观察频率不错，可以继续关联进食后 15-30 分钟的外出。");
  if (latestWeight) strengths.push(`最近体重记录为 ${latestWeight.weightKg}kg，建议每周固定时间称重。`);

  const actions = [];
  if (foodEvents.length < 3) actions.push("今天饮食记录偏少，建议补齐早中晚喂食量，方便观察食欲。");
  if (pottyEvents.length < 3) actions.push("幼犬膀胱控制还在发育，醒后、饭后、玩耍后都可以安排一次如厕。");
  if (delta !== null && Math.abs(delta) > 0.25) actions.push("体重变化较明显，先确认称重时间和饭前饭后条件是否一致。");
  if (reminders.filter((item) => item.active).length < 3) actions.push("可以补充早晚喂食、睡前如厕和下一次驱虫提醒。");

  return {
    title: `${pet?.name || "小狗"}今日养育简报`,
    riskLevel: "info",
    body: [
      strengths.length ? `做得好的地方：${strengths.join(" ")}` : "今天还没有足够记录形成稳定判断。",
      actions.length ? `下一步建议：${actions.join(" ")}` : "节奏稳定，继续记录饮食、排便和体重即可。",
      "健康相关判断不能替代兽医诊断；若持续呕吐、腹泻、精神差或拒食，请及时联系兽医。"
    ].join("\n")
  };
}
