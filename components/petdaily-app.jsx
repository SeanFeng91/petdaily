"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioWaveform,
  Bell,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Dog,
  HeartPulse,
  Home,
  LineChart,
  Moon,
  PauseCircle,
  Pencil,
  PawPrint,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings,
  SkipForward,
  Sparkles,
  Sprout,
  Syringe,
  Trash2,
  Utensils
} from "lucide-react";
import {
  Button as MobileButton,
  CapsuleTabs,
  ConfigProvider,
  FloatingBubble,
  Popup,
  SwipeAction,
  TabBar,
  Tag
} from "antd-mobile";
import zhCN from "antd-mobile/es/locales/zh-CN";
import { ExpenseChart, WeightChart } from "@/components/charts-panel";
import BarkMonitorPanel from "@/components/bark-monitor";
import QuickRecordSheet from "@/components/quick-record-sheet";
import { compressImageFile } from "@/components/image-file";
import {
  EVENT_TYPES,
  EXPENSE_CATEGORIES,
  REMINDER_KINDS,
  formatCurrency,
  formatDate,
  formatDateTime
} from "@/lib/domain";

const navItems = [
  { id: "today", label: "时间轴", icon: Home },
  { id: "bark", label: "监听", icon: AudioWaveform },
  { id: "insights", label: "洞察", icon: LineChart },
  { id: "profile", label: "我的", icon: Settings }
];

const eventIcons = {
  FOOD: Utensils,
  POTTY: PawPrint,
  STOOL: PawPrint,
  WEIGHT: LineChart,
  VACCINE: Syringe,
  DEWORM: HeartPulse,
  PHOTO: Camera,
  BARK: AudioWaveform,
  NOTE: BookOpen
};

const timelinePlotRows = [
  { id: "sleep", label: "睡觉", icon: Moon, types: new Set(["NOTE"]), tone: "sleep", matcher: /睡|午睡|休息|安静|笼/i },
  { id: "food", label: "进食", icon: Utensils, types: new Set(["FOOD"]), tone: "food" },
  { id: "potty", label: "尿尿", icon: PawPrint, types: new Set(["POTTY"]), tone: "pee" },
  { id: "stool", label: "便便", icon: PawPrint, types: new Set(["STOOL"]), tone: "poop" },
  { id: "play", label: "玩耍", icon: Sprout, types: new Set(["NOTE"]), tone: "play", matcher: /玩|训练|游戏|外出|散步/i },
  { id: "care", label: "护理", icon: HeartPulse, types: new Set(["WEIGHT", "VACCINE", "DEWORM", "PHOTO", "BARK"]), tone: "care" }
];

const LEGACY_SHORTCUT_STORAGE_KEY = "petdaily.eventShortcuts.v1";
const SHORTCUT_STORAGE_KEY = "petdaily.eventShortcuts.v2";
const APP_ICON_STORAGE_KEY = "petdaily.appIcon.v1";
const defaultEventShortcuts = [
  { id: "breakfast", enabled: true, label: "早餐", note: "", mode: "point" },
  { id: "dinner", enabled: true, label: "晚餐", note: "", mode: "point" },
  { id: "pee", enabled: true, label: "尿尿", note: "", mode: "point" },
  { id: "poop", enabled: true, label: "便便", note: "", mode: "point" },
  { id: "training", enabled: true, label: "训练", note: "", mode: "range" },
  { id: "nap", enabled: false, label: "睡觉", note: "", mode: "range" },
  { id: "weight", enabled: false, label: "称重", note: "早餐前称重。", mode: "point" },
  { id: "vaccine", enabled: false, label: "疫苗", note: "", mode: "point" },
  { id: "deworm", enabled: false, label: "驱虫", note: "", mode: "point" }
];

function createEventPresetId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `preset_${crypto.randomUUID()}`;
  return `preset_${Date.now()}_${Math.round(Math.random() * 1000)}`;
}

function updateAppIconLinks(iconUrl) {
  if (typeof document === "undefined" || !iconUrl) return;
  const versionedUrl = iconUrl.startsWith("data:")
    ? iconUrl
    : `${iconUrl}${iconUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
  const iconType = iconUrl.startsWith("data:image/png") ? "image/png" : iconUrl.startsWith("data:image/jpeg") ? "image/jpeg" : undefined;

  const existingIconLinks = [...document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')];
  const iconLinks = existingIconLinks.length ? existingIconLinks : [document.createElement("link")];
  for (const link of iconLinks) {
    if (!link.parentNode) document.head.appendChild(link);
    link.rel = "icon";
    link.href = versionedUrl;
    if (iconType) link.type = iconType;
    else link.removeAttribute("type");
  }

  let appleLink = document.querySelector('link[rel="apple-touch-icon"]');
  if (!appleLink) {
    appleLink = document.createElement("link");
    appleLink.rel = "apple-touch-icon";
    appleLink.sizes = "180x180";
    document.head.appendChild(appleLink);
  }
  appleLink.href = versionedUrl;
  if (iconType) appleLink.type = iconType;
  else appleLink.removeAttribute("type");

  let manifestLink = document.querySelector('link[rel="manifest"]');
  if (!manifestLink) {
    manifestLink = document.createElement("link");
    manifestLink.rel = "manifest";
    document.head.appendChild(manifestLink);
  }

  try {
    const manifestIconUrl = versionedUrl.startsWith("data:") ? versionedUrl : new URL(versionedUrl, window.location.origin).href;
    const manifest = {
      name: "PetDaily 白板日记",
      short_name: "PetDaily",
      description: "手机优先的宠物日常记录、提醒和成长洞察工具。",
      start_url: new URL("/", window.location.origin).href,
      scope: new URL("/", window.location.origin).href,
      display: "standalone",
      background_color: "#f7faf8",
      theme_color: "#18231f",
      orientation: "portrait",
      icons: [
        { src: manifestIconUrl, sizes: "192x192", ...(iconType ? { type: iconType } : {}), purpose: "any" },
        { src: manifestIconUrl, sizes: "512x512", ...(iconType ? { type: iconType } : {}), purpose: "any maskable" }
      ]
    };
    const previousManifestUrl = window.__petdailyDynamicManifestUrl;
    const nextManifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
    window.__petdailyDynamicManifestUrl = nextManifestUrl;
    manifestLink.href = nextManifestUrl;
    if (previousManifestUrl) URL.revokeObjectURL(previousManifestUrl);
  } catch {
    manifestLink.href = "/manifest.webmanifest";
  }
}

function sanitizeShortcutLabel(value, fallback = "事件") {
  const label = String(value || fallback).trim().slice(0, 12);
  return label || fallback;
}

function normalizeShortcuts(value) {
  if (!Array.isArray(value)) return defaultEventShortcuts;
  if (!value.length) return [];
  const byId = new Map(defaultEventShortcuts.map((item) => [item.id, item]));
  const merged = value
    .filter((item) => item && item.id)
    .map((item) => {
      const fallback = byId.get(item.id) || defaultEventShortcuts[0];
      const mode = item.mode === "range" ? "range" : "point";
      return {
        id: String(item.id),
        enabled: item.enabled !== false,
        label: sanitizeShortcutLabel(item.label || item.title, fallback.label),
        note: item.note == null ? "" : String(item.note).slice(0, 80),
        mode
      };
    });

  return merged.length ? merged.slice(0, 12) : defaultEventShortcuts;
}

function getTodayStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isSameDay(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getReminderStatus(reminder, now = new Date()) {
  if (!reminder.active) return { key: "paused", label: "已暂停" };
  if (isSameDay(reminder.lastDoneAt, now)) return { key: "done", label: "今日已完成" };
  if (isSameDay(reminder.lastSkippedAt, now)) return { key: "skipped", label: "今日已跳过" };
  const [hours, minutes] = reminder.scheduledTime.split(":").map(Number);
  const dueAt = new Date(now);
  dueAt.setHours(hours || 0, minutes || 0, 0, 0);
  if (dueAt <= now) return { key: "due", label: "已到点" };
  return { key: "upcoming", label: "稍后" };
}

function getExpenseSummary(expenses) {
  const totalCents = expenses.reduce((sum, item) => sum + item.amountCents, 0);
  const byCategory = expenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amountCents;
    return acc;
  }, {});
  return { totalCents, byCategory };
}

function sortExpenses(expenses) {
  return [...expenses].sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));
}

function sortWeightRecords(weightRecords) {
  return [...weightRecords].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt));
}

function localDateValue(value = new Date()) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function localDateTimeValue(value = new Date()) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function getTimelineDateKey(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function getTodayDateKey() {
  return getTimelineDateKey(new Date());
}

function isTodayKey(key) {
  return key === getTodayDateKey();
}

function formatDateKeyLabel(key) {
  if (isTodayKey(key)) return "今天";
  const [, month, day] = key.split("-");
  return `${month}/${day}`;
}

function formatDateKeyWeekday(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short"
  }).format(new Date(year, month - 1, day));
}

function buildTimelineDayGroups(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = getTimelineDateKey(event.happenedAt);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(event);
  }

  const groups = [...byKey.entries()]
    .map(([key, groupEvents]) => ({
      key,
      label: formatDateKeyLabel(key),
      subLabel: formatDateKeyWeekday(key),
      events: groupEvents.sort((a, b) => new Date(a.happenedAt) - new Date(b.happenedAt))
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  if (!byKey.has(getTodayDateKey())) {
    groups.unshift({
      key: getTodayDateKey(),
      label: "今天",
      subLabel: formatDateKeyWeekday(getTodayDateKey()),
      events: []
    });
  }

  return groups;
}

function buildRecentTimelineGroups(events, days = 7) {
  const existing = new Map(buildTimelineDayGroups(events).map((group) => [group.key, group]));
  const groups = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = getTimelineDateKey(date);
    groups.push(existing.get(key) || {
      key,
      label: formatDateKeyLabel(key),
      subLabel: formatDateKeyWeekday(key),
      events: []
    });
  }

  return groups;
}

function formatTimelineDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatTimelineWeekday(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short"
  }).format(new Date(value));
}

function formatTimelineTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getEventMetadata(event) {
  return parseJsonObject(event?.metadata);
}

function isImplicitRangeEvent(event) {
  if (!event) return false;
  if (event.type === "BARK") return true;
  if (event.type !== "NOTE") return false;
  const title = `${event.title || ""} ${event.note || ""}`;
  return /睡|午睡|休息|安静|笼|玩|训练|游戏|外出|散步/i.test(title);
}

function getEventEndTime(event) {
  const metadata = getEventMetadata(event);
  const start = new Date(event.happenedAt).getTime();
  const explicitEnd = metadata.endedAt ? new Date(metadata.endedAt).getTime() : null;
  if (Number.isFinite(explicitEnd) && explicitEnd > start) return explicitEnd;

  const durationMs = Number(metadata.durationMs || event.durationMs || 0);
  if (Number.isFinite(durationMs) && durationMs > 0) return start + durationMs;

  const createdAt = event.createdAt ? new Date(event.createdAt).getTime() : null;
  if (event.type === "NOTE" && Number.isFinite(createdAt) && createdAt > start + 10 * 60000) return createdAt;

  if (isImplicitRangeEvent(event)) {
    return start + (event.type === "BARK" ? 6 * 60000 : 30 * 60000);
  }

  return start;
}

function hasEventTimeRange(event) {
  if (!event) return false;
  const metadata = getEventMetadata(event);
  return isImplicitRangeEvent(event) || Boolean(metadata.endedAt || metadata.durationMs || event.durationMs);
}

function getEventEndInputValue(event) {
  if (!event || !hasEventTimeRange(event)) return "";
  const start = new Date(event.happenedAt).getTime();
  const end = getEventEndTime(event);
  return Number.isFinite(end) && end > start ? localDateTimeValue(end) : "";
}

function formatEventRange(event) {
  if (!event) return "";
  const start = new Date(event.happenedAt);
  const end = new Date(getEventEndTime(event));
  if (!hasEventTimeRange(event) || !Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    return formatDateTime(event.happenedAt);
  }
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${formatDateTime(start)} - ${formatTimelineTime(end)}`
    : `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

function getTimelinePlotRow(event) {
  const title = `${event.title || ""} ${event.note || ""}`;
  return (
    timelinePlotRows.find((row) => {
      if (!row.types.has(event.type)) return false;
      return row.matcher ? row.matcher.test(title) : true;
    }) || timelinePlotRows[timelinePlotRows.length - 1]
  );
}

function getDayProgress(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  return ((date.getHours() * 60 + date.getMinutes()) / 1440) * 100;
}

function formatDayDistributionHour(hour) {
  const meridiem = hour < 12 ? "AM" : "PM";
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return { meridiem, label: String(normalizedHour).padStart(2, "0") };
}

function getVisibleDayDistributionGroups(groups, focusKey, limit = 4) {
  if (!groups.length) return [];
  const safeLimit = Math.max(1, limit);
  const focusIndex = focusKey ? groups.findIndex((group) => group.key === focusKey) : -1;

  if (focusIndex >= 0) {
    const start = Math.max(0, Math.min(focusIndex, Math.max(0, groups.length - safeLimit)));
    return [...groups.slice(start, start + safeLimit)].reverse();
  }

  return [...groups.slice(0, safeLimit)].reverse();
}

function getDerivedData(data) {
  const timelineEvents = [...data.timelineEvents].sort(
    (a, b) => new Date(b.happenedAt) - new Date(a.happenedAt)
  );
  const journalEvents = timelineEvents.filter((event) => event.type !== "BARK");
  const weightRecords = [...data.weightRecords].sort(
    (a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)
  );
  const todayStart = getTodayStart();
  const todayEvents = journalEvents.filter((event) => new Date(event.happenedAt) >= todayStart);
  const latestWeight = weightRecords.at(-1);
  const previousWeight = weightRecords.at(-2);
  const expenseSummary = getExpenseSummary(data.expenses);

  return {
    timelineEvents,
    journalEvents,
    weightRecords,
    todayEvents,
    latestWeight,
    weightDelta:
      latestWeight && previousWeight
        ? Number((latestWeight.weightKg - previousWeight.weightKg).toFixed(2))
        : null,
    activeReminders: data.reminders.filter((item) => item.active && !isSameDay(item.lastDoneAt) && !isSameDay(item.lastSkippedAt)),
    expenseSummary
  };
}

function getShortcutTone(shortcut) {
  return shortcut.mode === "range" ? "sky" : "mint";
}

function NavButton({ item, selected, onClick }) {
  const Icon = item.icon;
  return (
    <button className={`navButton ${selected ? "selected" : ""}`} type="button" onClick={onClick}>
      <Icon size={19} />
      <span>{item.label}</span>
    </button>
  );
}

function EmptyState() {
  return (
    <main className="emptyState">
      <div className="emptyMark">
        <Dog size={44} />
      </div>
      <h1>PetDaily 需要初始化数据</h1>
      <p>请先运行数据库脚本：`npm run db:push` 和 `npm run db:seed`。</p>
    </main>
  );
}

function PhotoLightbox({ photo, onClose }) {
  useEffect(() => {
    if (!photo) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, photo]);

  if (!photo) return null;

  return (
    <div className="photoLightbox" role="dialog" aria-modal="true" aria-label="照片浏览">
      <button className="photoLightboxBackdrop" type="button" onClick={onClose} aria-label="关闭照片预览" />
      <figure>
        <img src={photo.url} alt={photo.title || "宠物照片"} />
        <figcaption>
          <strong>{photo.title || "成长照片"}</strong>
          {photo.takenAt ? <span>{formatDateTime(photo.takenAt)}</span> : null}
        </figcaption>
      </figure>
      <button className="photoLightboxClose" type="button" onClick={onClose} aria-label="关闭照片预览">
        ×
      </button>
    </div>
  );
}

function CoachPanel({ pet, localCoach, latestInsight, onGenerate, loading }) {
  const insight = latestInsight || localCoach;
  return (
    <section className="coachPanel">
      <div className="coachHeader">
        <div className="coachMark">
          <Sparkles size={19} />
        </div>
        <div>
          <p>{insight?.title || `${pet.name}今日养育建议`}</p>
          <span>AI 教练基于最近记录给出保守建议</span>
        </div>
      </div>
      <div className="coachBody">
        {(insight?.body || "继续记录饮食、如厕和体重，我会在这里帮你整理规律。")
          .split("\n")
          .map((line) => (
            <p key={line}>{line}</p>
          ))}
      </div>
      <button className="secondaryButton" type="button" onClick={onGenerate} disabled={loading}>
        <RefreshCw size={16} />
        {loading ? "生成中..." : "生成今日建议"}
      </button>
    </section>
  );
}

function TimelineStream({ events, onDelete, onOpenDetail, onOpenPhoto }) {
  const groups = useMemo(() => {
    const grouped = [];
    const index = new Map();

    for (const event of events) {
      const key = getTimelineDateKey(event.happenedAt);
      if (!index.has(key)) {
        const group = { key, date: event.happenedAt, events: [] };
        grouped.push(group);
        index.set(key, group);
      }
      index.get(key).events.push(event);
    }

    return grouped;
  }, [events]);

  if (!events.length) {
    return <p className="mutedText">还没有记录。先从刚发生的事件开始写一条。</p>;
  }

  return (
    <div className="timelineStream">
      {groups.map((group) => (
        <section className="timelineDayGroup" key={group.key}>
          <div className="timelineDay">
            <strong>{formatTimelineDate(group.date)}</strong>
            <span>{formatTimelineWeekday(group.date)}</span>
          </div>
          <div className="timelineEntries">
            {group.events.map((event) => {
              const Icon = eventIcons[event.type] || BookOpen;
              const meta = EVENT_TYPES[event.type] || EVENT_TYPES.NOTE;
              return (
                <article className={`timelineEntry tone-${meta.tone}`} key={event.id}>
                  <div className="timelineEntryTime">{formatTimelineTime(event.happenedAt)}</div>
                  <div className="timelineEntryDot" />
                  <div className="timelineEntryBody">
                    <div className="timelineEntryHeader">
                      <span className={`timelineType tone-${meta.tone}`}>
                        <Icon size={14} />
                        {meta.label}
                      </span>
                      <strong>{event.title}</strong>
                      {event.amount ? (
                        <b>
                          {event.amount}
                          {event.unit || meta.unit}
                        </b>
                      ) : null}
                      {onOpenDetail || onDelete ? (
                        <div className="timelineEntryActions">
                          {onDelete ? (
                            <button className="miniDangerButton" type="button" onClick={() => onDelete(event)}>
                              <Trash2 size={15} />
                              删除
                            </button>
                          ) : null}
                          {onOpenDetail ? (
                            <button className="miniActionButton iconOnlyAction timelineChevronButton" type="button" onClick={() => onOpenDetail(event)} aria-label={`查看 ${event.title} 详情`}>
                              <ChevronRight size={16} />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {event.note ? <p>{event.note}</p> : null}
                    {event.photoUrl ? (
                      <button
                        className="photoOpenButton timelineEntryPhotoButton"
                        type="button"
                        onClick={() => onOpenPhoto?.({ url: event.photoUrl, title: event.title, takenAt: event.happenedAt })}
                      >
                        <img className="timelineEntryPhoto" src={event.photoUrl} alt={event.title} />
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function DesktopDayDistribution({ events, onOpenDetail }) {
  const groups = useMemo(() => buildTimelineDayGroups(events), [events]);

  return (
    <section className="contentPanel desktopDayDistribution">
      <div className="sectionHeading">
        <p>日分布</p>
        <span>最近几天的纵向分布</span>
      </div>
      <DayDistributionTimeline groups={groups} focusKey={getTodayDateKey()} onOpenDetail={onOpenDetail} />
    </section>
  );
}

function ShortcutGrid({ shortcuts, onTrigger, onConfigure }) {
  const visibleShortcuts = shortcuts.filter((shortcut) => shortcut.enabled && shortcut.label?.trim());

  return (
    <section className="shortcutPanel">
      <div className="shortcutHeader">
        <div>
          <p>快捷事件</p>
          <span>
            {visibleShortcuts.length
              ? `数字键 1-${Math.min(visibleShortcuts.length, 9)} 可快速打开预填表单`
              : "到我的页面启用常用事件"}
          </span>
        </div>
        <button className="miniActionButton shortcutConfigureButton" type="button" onClick={onConfigure} aria-label="配置快捷事件">
          <Settings size={14} />
          <span>配置</span>
        </button>
      </div>
      <div className="shortcutGrid">
        {visibleShortcuts.length ? visibleShortcuts.map((shortcut, index) => {
          return (
            <button
              className={`shortcutButton tone-${getShortcutTone(shortcut)}`}
              type="button"
              key={shortcut.id}
              onClick={() => onTrigger(shortcut)}
            >
              <span>{index < 9 ? index + 1 : ""}</span>
              <strong>{shortcut.label}</strong>
              <small>{shortcut.mode === "range" ? "时段" : "单点"}</small>
            </button>
          );
        }) : <p className="mutedText shortcutEmpty">还没有启用的快捷事件。</p>}
      </div>
    </section>
  );
}

function ReminderList({ reminders, onComplete, onSkip, onToggle, onDelete }) {
  return (
    <div className="reminderList">
      {reminders.map((reminder) => {
        const status = getReminderStatus(reminder);
        return (
          <article className={`reminderItem status-${status.key}`} key={reminder.id}>
            <div>
              <strong>{reminder.scheduledTime}</strong>
              <span>{REMINDER_KINDS[reminder.kind] || reminder.kind}</span>
            </div>
            <p>{reminder.title}</p>
            <span className="reminderStatus"><Clock3 size={13} />{status.label}</span>
            <div className="reminderActions">
              <button className="checkButton" type="button" onClick={() => onComplete(reminder)} aria-label="完成提醒">
                {status.key === "done" ? <CheckCircle2 size={16} /> : <Check size={16} />}
              </button>
              {onSkip ? (
                <button className="checkButton skip" type="button" onClick={() => onSkip(reminder)} aria-label={status.key === "skipped" ? "取消跳过提醒" : "跳过提醒"}>
                  <SkipForward size={16} />
                </button>
              ) : null}
              <button className="checkButton" type="button" onClick={() => onToggle(reminder)} aria-label={reminder.active ? "暂停提醒" : "启用提醒"}>
                {reminder.active ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
              </button>
              {onDelete ? (
                <button className="checkButton danger" type="button" onClick={() => onDelete(reminder)} aria-label="删除提醒">
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function getCompactReminderList(reminders) {
  return [...reminders]
    .sort((a, b) => {
      const statusA = getReminderStatus(a);
      const statusB = getReminderStatus(b);
      const priority = { due: 0, upcoming: 1, skipped: 2, done: 3, paused: 4 };
      if (priority[statusA.key] !== priority[statusB.key]) {
        return priority[statusA.key] - priority[statusB.key];
      }
      return a.scheduledTime.localeCompare(b.scheduledTime);
    })
    .slice(0, 2);
}

function MobileEventDetailPopup({ event, onClose, onDelete, onEdit, onOpenPhoto }) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editStartAt, setEditStartAt] = useState("");
  const [editEndAt, setEditEndAt] = useState("");
  const [editRangeEnabled, setEditRangeEnabled] = useState(false);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (event) {
      setEditTitle(event.title || "");
      setEditNote(event.note || "");
      setEditAmount(event.amount != null ? String(event.amount) : "");
      setEditStartAt(localDateTimeValue(event.happenedAt));
      setEditEndAt(getEventEndInputValue(event));
      setEditRangeEnabled(hasEventTimeRange(event));
      setEditError("");
      setEditing(false);
    }
  }, [event]);

  if (!event) return null;
  const Icon = eventIcons[event.type] || BookOpen;
  const meta = EVENT_TYPES[event.type] || EVENT_TYPES.NOTE;
  const supportsRange = editRangeEnabled;
  const displaysRange = hasEventTimeRange(event);
  const showAmountField = event.amount != null || Boolean(meta.unit);

  async function saveEdit() {
    if (!onEdit) return;
    const startAt = new Date(editStartAt);
    if (!Number.isFinite(startAt.getTime())) {
      setEditError("开始时间格式不正确。");
      return;
    }

    const nextMetadata = { ...getEventMetadata(event) };
    if (supportsRange) {
      if (editEndAt) {
        const endAt = new Date(editEndAt);
        if (!Number.isFinite(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
          setEditError("结束时间需要晚于开始时间。");
          return;
        }
        nextMetadata.endedAt = endAt.toISOString();
        nextMetadata.durationMs = Math.max(60000, endAt.getTime() - startAt.getTime());
      } else {
        setEditError("开启持续时段后，请补充结束时间。");
        return;
      }
    } else {
      delete nextMetadata.endedAt;
      delete nextMetadata.durationMs;
    }

    setEditError("");
    setSaving(true);
    try {
      await onEdit({
        id: event.id,
        title: editTitle,
        note: editNote,
        amount: showAmountField ? editAmount : undefined,
        happenedAt: startAt.toISOString(),
        metadata: nextMetadata
      });
      setEditing(false);
      onClose?.();
    } catch (error) {
      setEditError(error?.message || "保存失败，请稍后再试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popup
      visible={Boolean(event)}
      onMaskClick={onClose}
      onClose={onClose}
      position="bottom"
      bodyClassName="mobileEventPopup"
      closeOnSwipe
    >
      <div className="mobileEventDetail">
        <div className="mobileEventDetailHeader">
          <span className={`mobileTimelineGlyph tone-${meta.tone}`}>
            <Icon size={16} />
          </span>
          <div>
            <Tag color="primary" fill="outline">{meta.label}</Tag>
            {editing ? (
              <input className="mobileEventEditInput" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="标题" />
            ) : (
              <h3>{event.title}</h3>
            )}
            <p>{formatEventRange(event)}</p>
          </div>
        </div>
        {editing ? (
          <>
            <div className="mobileEventFact">
              <span>记录方式</span>
              <button className="miniActionButton" type="button" onClick={() => setEditRangeEnabled((current) => !current)}>
                {editRangeEnabled ? "持续时段" : "单点事件"}
              </button>
            </div>
            <div className="formGridTwo">
              <label>
                开始
                <input className="mobileEventEditInput" type="datetime-local" value={editStartAt} onChange={(e) => setEditStartAt(e.target.value)} />
              </label>
              {supportsRange ? (
                <label>
                  结束
                  <input className="mobileEventEditInput" type="datetime-local" value={editEndAt} onChange={(e) => setEditEndAt(e.target.value)} />
                </label>
              ) : null}
            </div>
            {showAmountField ? (
              <div className="mobileEventFact">
                <span>数值</span>
                <input className="mobileEventEditInput small" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="数值" inputMode="decimal" />
              </div>
            ) : null}
            <textarea className="mobileEventEditTextarea" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="备注" rows={3} />
            {editError ? <p className="formError">{editError}</p> : null}
          </>
        ) : (
          <>
            <div className="mobileEventFact">
              <span>{displaysRange ? "时段" : "时间"}</span>
              <strong>{formatEventRange(event)}</strong>
            </div>
            {event.amount != null ? (
              <div className="mobileEventFact">
                <span>数值</span>
                <strong>{event.amount}{event.unit || meta.unit}</strong>
              </div>
            ) : null}
            {event.photoUrl ? (
              <button className="photoOpenButton mobileEventPhotoButton" type="button" onClick={() => onOpenPhoto?.({ url: event.photoUrl, title: event.title, takenAt: event.happenedAt })}>
                <img className="mobileEventDetailPhoto" src={event.photoUrl} alt={event.title} />
              </button>
            ) : null}
            {event.note ? <p className="mobileEventDetailNote">{event.note}</p> : <p className="mutedText mobileEventDetailNote">这条记录暂时没有备注。</p>}
          </>
        )}
        <div className="mobileEventDetailActions">
          {editing ? (
            <>
              <MobileButton block fill="outline" onClick={() => setEditing(false)}>取消</MobileButton>
              <MobileButton block color="primary" onClick={saveEdit} disabled={saving}>{saving ? "保存中" : "保存"}</MobileButton>
            </>
          ) : (
            <>
              {onEdit ? <MobileButton block fill="outline" onClick={() => setEditing(true)}><Pencil size={14} /> 编辑</MobileButton> : null}
              {onDelete ? (
                <MobileButton block color="danger" fill="outline" onClick={() => { onClose(); onDelete(event); }}>删除</MobileButton>
              ) : null}
              <MobileButton block fill="outline" onClick={onClose}>关闭</MobileButton>
            </>
          )}
        </div>
      </div>
    </Popup>
  );
}

function DayDistributionTimeline({ groups, focusKey, onOpenDetail, limit = 4, showHeaders = true, className = "", emptyText, includeEmptyGroups = false }) {
  const scrollerRef = useRef(null);
  const sourceGroups = useMemo(
    () => (includeEmptyGroups ? groups || [] : (groups || []).filter((group) => group.events.length || isTodayKey(group.key))),
    [groups, includeEmptyGroups]
  );
  const visibleGroups = useMemo(
    () => getVisibleDayDistributionGroups(sourceGroups, focusKey, limit),
    [focusKey, limit, sourceGroups]
  );
  const hasEvents = visibleGroups.some((group) => group.events.length);

  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const now = new Date();
  const currentLineTop = getDayProgress(now);
  const showCurrentLine = visibleGroups.some((group) => isTodayKey(group.key));
  const activeGroup = visibleGroups.find((group) => group.key === focusKey) || visibleGroups.at(-1) || visibleGroups[0];

  const anchorProgress = useMemo(() => {
    if (showCurrentLine && activeGroup && isTodayKey(activeGroup.key)) {
      return Math.max(0, currentLineTop - 8);
    }

    const firstEvent = [...(activeGroup?.events || [])]
      .sort((left, right) => new Date(left.happenedAt) - new Date(right.happenedAt))
      .at(0);
    return firstEvent ? Math.max(0, getDayProgress(new Date(firstEvent.happenedAt)) - 8) : 0;
  }, [activeGroup, currentLineTop, showCurrentLine]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 8) return;
    const targetTop = Math.max(0, (scroller.scrollHeight - scroller.clientHeight) * (anchorProgress / 100) - scroller.clientHeight * 0.18);
    scroller.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [anchorProgress, focusKey]);

  if (!hasEvents) {
    return <p className="mutedText mobileEmptyText">{emptyText || "这个日期还没有形成分布。新增记录后会自动排到一天刻度上。"}</p>;
  }

  return (
    <div className={`dayDistributionBoard ${className}`.trim()} aria-label="多日纵向时间分布">
      <div className="dayDistributionLegend">
        <span><i className="range" />持续时段</span>
        <span><i className="point" />单点事件</span>
      </div>
      <div className="dayDistributionScroller" ref={scrollerRef}>
        <div className={`dayDistributionMatrix ${showHeaders ? "" : "headless"}`} style={{ "--day-column-count": String(visibleGroups.length) }}>
          {showHeaders ? (
            <div className="dayDistributionCorner">
              <strong>Time</strong>
            </div>
          ) : null}
          {showHeaders
            ? visibleGroups.map((group, index) => (
                <div
                  className={`dayDistributionDayHead ${group.key === focusKey ? "selected" : ""}`}
                  key={`head-${group.key}`}
                  style={{ gridColumn: index + 2 }}
                >
                  <strong>{group.label}</strong>
                  <span>{group.subLabel}</span>
                </div>
              ))
            : null}

          <div className="dayDistributionTimeAxis" aria-hidden="true">
            {hours.map((hour) => {
              const { meridiem, label } = formatDayDistributionHour(hour);
              return (
                <div className="dayDistributionHour" key={hour} style={{ top: `${(hour / 24) * 100}%` }}>
                  <span>{meridiem}</span>
                  <strong>{label}</strong>
                </div>
              );
            })}
          </div>

          <div className="dayDistributionTracksOverlay">
            {showCurrentLine ? (
              <div className="dayDistributionNowLine" style={{ top: `${currentLineTop}%` }}>
                <span>现在 {formatTimelineTime(now)}</span>
              </div>
            ) : null}
          </div>

          {visibleGroups.map((group, index) => (
            <div
              className={`dayDistributionDayTrack ${group.key === focusKey ? "selected" : ""}`}
              key={group.key}
              style={{ gridColumn: index + 2 }}
            >
              {hours.map((hour) => (
                <i className="dayDistributionHourLine" key={`${group.key}-${hour}`} style={{ top: `${(hour / 24) * 100}%` }} />
              ))}
              {group.events.map((event) => {
                const row = getTimelinePlotRow(event);
                const dayStart = new Date(`${group.key}T00:00`);
                const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                const start = new Date(event.happenedAt);
                const end = new Date(getEventEndTime(event));
                const top = getDayProgress(start);
                const endProgress =
                  end >= dayEnd ? 100 : end <= dayStart ? top : getDayProgress(end);
                const isRange = hasEventTimeRange(event) && endProgress > top + 0.35;

                return (
                  <button
                    className={`dayDistributionEvent ${isRange ? "range" : "point"} tone-${row.tone}`}
                    type="button"
                    key={event.id}
                    style={isRange ? { top: `${top}%`, height: `${Math.max(1.1, endProgress - top)}%` } : { top: `${top}%` }}
                    onClick={() => onOpenDetail?.(event)}
                    aria-label={`${group.label} ${formatTimelineTime(event.happenedAt)} ${event.title}`}
                    title={`${group.label} ${formatTimelineTime(event.happenedAt)} ${event.title}`}
                  >
                    <span>{event.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileTimelineEntry({ event, onDelete, onOpenDetail, onOpenPhoto }) {
  const Icon = eventIcons[event.type] || BookOpen;
  const meta = EVENT_TYPES[event.type] || EVENT_TYPES.NOTE;

  return (
    <SwipeAction
      key={event.id}
      rightActions={onDelete ? [{ key: "delete", text: "删除", color: "danger", onClick: () => onDelete(event) }] : []}
    >
      <article className={`mobileTimelineRow tone-${meta.tone}`}>
        <span className="mobileTimelineTime">{formatTimelineTime(event.happenedAt)}</span>
        <span className="mobileTimelineGlyph">
          <Icon size={14} />
        </span>
        <div className="mobileTimelineCopy">
          <div>
            <strong>{event.title}</strong>
            {event.amount ? (
              <b>
                {event.amount}
                {event.unit || meta.unit}
              </b>
            ) : null}
          </div>
          {event.note ? <p>{event.note}</p> : null}
        </div>
        {event.photoUrl ? (
          <button
            className="photoOpenButton mobileTimelineThumbButton"
            type="button"
            onClick={() => onOpenPhoto?.({ url: event.photoUrl, title: event.title, takenAt: event.happenedAt })}
          >
            <img className="mobileTimelineThumb" src={event.photoUrl} alt={event.title} />
          </button>
        ) : null}
        <MobileButton className="mobileDetailButton iconOnlyAction" size="mini" fill="none" onClick={() => onOpenDetail(event)} aria-label={`查看 ${event.title} 详情`}>
          <ChevronRight size={14} />
        </MobileButton>
      </article>
    </SwipeAction>
  );
}

function MobileTimelineList({ events, onDelete, onOpenDetail, onOpenPhoto, emptyText }) {
  if (!events.length) {
    return <p className="mutedText mobileEmptyText">{emptyText || "这个日期还没有记录。点右下角新增一条。"}</p>;
  }

  return (
    <div className="mobileTimelineList">
      {events.map((event) => (
        <MobileTimelineEntry
          key={event.id}
          event={event}
          onDelete={onDelete}
          onOpenDetail={onOpenDetail}
          onOpenPhoto={onOpenPhoto}
        />
      ))}
    </div>
  );
}

function MobileTimelineWeekList({ groups, onDelete, onOpenDetail, onOpenPhoto, emptyText }) {
  const weekEvents = groups.reduce((sum, group) => sum + group.events.length, 0);

  if (!weekEvents) {
    return <p className="mutedText mobileEmptyText">{emptyText || "最近 7 天还没有记录。点右下角新增一条。"}</p>;
  }

  return (
    <div className="mobileTimelineList weekMode">
      {groups.map((group) => (
        <section className="mobileWeekGroup" key={group.key}>
          <div className="mobileWeekDivider">
            <strong>{group.label}</strong>
            <span>{group.subLabel}</span>
          </div>
          {group.events.length ? (
            <div className="mobileWeekEntries">
              {[...group.events].sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt)).map((event) => (
                <MobileTimelineEntry
                  key={event.id}
                  event={event}
                  onDelete={onDelete}
                  onOpenDetail={onOpenDetail}
                  onOpenPhoto={onOpenPhoto}
                />
              ))}
            </div>
          ) : (
            <p className="mutedText mobileWeekEmpty">这一天没有记录</p>
          )}
        </section>
      ))}
    </div>
  );
}

function MobileTodayView({
  data,
  derived,
  shortcuts,
  onShortcutTrigger,
  onConfigureShortcuts,
  onCompleteReminder,
  onSkipReminder,
  onToggleReminder,
  onDeleteEvent,
  onEditEvent,
  onOpenPhoto
}) {
  const dateGroups = useMemo(() => buildTimelineDayGroups(derived.journalEvents), [derived.journalEvents]);
  const weekGroups = useMemo(() => buildRecentTimelineGroups(derived.journalEvents, 7), [derived.journalEvents]);
  const [selectedDateKey, setSelectedDateKey] = useState("");
  const [detailEvent, setDetailEvent] = useState(null);
  const [timelineScope, setTimelineScope] = useState("day");
  const [timelineView, setTimelineView] = useState("calendar");
  const selectedGroup = dateGroups.find((group) => group.key === selectedDateKey) || dateGroups[0];
  const weekFocusKey = weekGroups.some((group) => group.key === selectedDateKey) ? selectedDateKey : getTodayDateKey();
  const weekEventCount = weekGroups.reduce((sum, group) => sum + group.events.length, 0);
  const compactReminders = getCompactReminderList(data.reminders);
  const dayEvents = useMemo(
    () => [...(selectedGroup?.events || [])].sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt)),
    [selectedGroup]
  );
  const timelineTitle =
    timelineView === "list"
      ? timelineScope === "day"
        ? "单日事件条目"
        : "一周事件条目"
      : timelineScope === "day"
        ? "单日日历"
        : "周日历";
  const timelineCount = timelineScope === "day" ? dayEvents.length : weekEventCount;

  useEffect(() => {
    if (!dateGroups.length) return;
    if (!selectedDateKey || !dateGroups.some((group) => group.key === selectedDateKey)) {
      const todayGroup = dateGroups.find((group) => group.key === getTodayDateKey());
      setSelectedDateKey((todayGroup || dateGroups[0]).key);
    }
  }, [dateGroups, selectedDateKey]);

  return (
    <section className="mobileTodayWorkbench" aria-label="手机端今日工作台">
      <header className="mobileTopBar">
        <div>
          <span>PetDaily</span>
          <strong>{data.pet.name}</strong>
        </div>
        <dl>
          <div>
            <dt>今日</dt>
            <dd>{derived.todayEvents.length}</dd>
          </div>
          <div>
            <dt>体重</dt>
            <dd>{derived.latestWeight ? `${derived.latestWeight.weightKg}kg` : "--"}</dd>
          </div>
        </dl>
      </header>

      <ShortcutGrid
        shortcuts={shortcuts}
        onTrigger={onShortcutTrigger}
        onConfigure={onConfigureShortcuts}
      />

      <section className="mobileReminderBlock">
        <div className="mobileSectionTitle">
          <strong>提醒</strong>
          <span>{compactReminders.length ? "优先显示到点事项" : "暂无提醒"}</span>
        </div>
        {compactReminders.length ? (
          <ReminderList reminders={compactReminders} onComplete={onCompleteReminder} onSkip={onSkipReminder} onToggle={onToggleReminder} />
        ) : (
          <p className="mutedText mobileEmptyText">到“我的”里添加喂食、外出或驱虫提醒。</p>
        )}
      </section>

      <section className="mobileTimelineCard">
        <div className="mobileTimelineTools">
          <div>
            <strong>{timelineTitle}</strong>
            <span>{timelineCount} 条</span>
          </div>
          <div className="mobileTimelineControlStack">
            <div className="mobileTimelineMode">
              <button className={timelineScope === "day" ? "selected" : ""} type="button" onClick={() => setTimelineScope("day")}>
                日
              </button>
              <button className={timelineScope === "week" ? "selected" : ""} type="button" onClick={() => setTimelineScope("week")}>
                周
              </button>
            </div>
            <div className="mobileTimelineMode">
              <button className={timelineView === "list" ? "selected" : ""} type="button" onClick={() => setTimelineView("list")}>
                条目
              </button>
              <button className={timelineView === "calendar" ? "selected" : ""} type="button" onClick={() => setTimelineView("calendar")}>
                日历
              </button>
            </div>
          </div>
          {timelineScope === "day" ? (
            <CapsuleTabs
              className="mobileDateTabs"
              activeKey={selectedGroup?.key}
              onChange={setSelectedDateKey}
            >
              {dateGroups.map((group) => (
                <CapsuleTabs.Tab
                  key={group.key}
                  title={
                    <span className="mobileDateTab">
                      <strong>{group.label}</strong>
                      <em>{group.subLabel}</em>
                    </span>
                  }
                />
              ))}
            </CapsuleTabs>
          ) : null}
        </div>
        {timelineScope === "week" && timelineView === "calendar" ? (
          <DayDistributionTimeline
            className="weekLayout"
            groups={weekGroups}
            focusKey={weekFocusKey}
            limit={7}
            includeEmptyGroups
            onOpenDetail={setDetailEvent}
            emptyText="最近 7 天还没有形成时间块。点右下角新增一条。"
          />
        ) : null}
        {timelineScope === "week" && timelineView === "list" ? (
          <MobileTimelineWeekList
            groups={weekGroups}
            onDelete={onDeleteEvent}
            onOpenDetail={setDetailEvent}
            onOpenPhoto={onOpenPhoto}
            emptyText="最近 7 天还没有记录。点右下角新增一条。"
          />
        ) : null}
        {timelineScope === "day" && timelineView === "calendar" ? (
          <DayDistributionTimeline
            className="singleDayLayout"
            groups={dateGroups}
            focusKey={selectedGroup?.key || getTodayDateKey()}
            limit={1}
            showHeaders={false}
            onOpenDetail={setDetailEvent}
            emptyText="这个日期还没有记录。点右下角新增一条。"
          />
        ) : null}
        {timelineScope === "day" && timelineView === "list" ? (
          <MobileTimelineList
            events={dayEvents}
            onDelete={onDeleteEvent}
            onOpenDetail={setDetailEvent}
            onOpenPhoto={onOpenPhoto}
            emptyText="这个日期还没有记录。点右下角新增一条。"
          />
        ) : null}
      </section>
      <MobileEventDetailPopup
        event={detailEvent}
        onClose={() => setDetailEvent(null)}
        onDelete={onDeleteEvent}
        onEdit={onEditEvent}
        onOpenPhoto={onOpenPhoto}
      />
    </section>
  );
}

function TodayView({
  data,
  derived,
  shortcuts,
  onShortcutTrigger,
  onConfigureShortcuts,
  onGenerateInsight,
  aiLoading,
  onCompleteReminder,
  onSkipReminder,
  onToggleReminder,
  onDeleteEvent,
  onEditEvent,
  onOpenPhoto
}) {
  const { pet, localCoach, insights } = data;
  const [detailEvent, setDetailEvent] = useState(null);
  const latestInsight = insights[0];

  return (
    <>
      <div className="desktopTodayView timelineWorkspace">
        <section className="timelineCommandBar">
          <div>
            <h1>白板日记</h1>
          </div>
        </section>

        <ShortcutGrid
          shortcuts={shortcuts}
          onTrigger={onShortcutTrigger}
          onConfigure={onConfigureShortcuts}
        />

        <DesktopDayDistribution events={derived.journalEvents} onOpenDetail={setDetailEvent} />

        <div className="timelineLayout">
          <section className="timelinePanel">
            <div className="timelineToolbar">
              <div>
                <p>事件流</p>
                <span>{derived.journalEvents.length} 条记录</span>
              </div>
            </div>
            <TimelineStream events={derived.journalEvents} onDelete={onDeleteEvent} onOpenDetail={setDetailEvent} onOpenPhoto={onOpenPhoto} />
          </section>

          <aside className="timelineAside">
            <section className="contentPanel compactPanel">
              <div className="sectionHeading">
                <p>待办提醒</p>
                <span>今日</span>
              </div>
              <ReminderList reminders={data.reminders.slice(0, 3)} onComplete={onCompleteReminder} onSkip={onSkipReminder} onToggle={onToggleReminder} />
            </section>
            <CoachPanel
              pet={pet}
              localCoach={localCoach}
              latestInsight={latestInsight}
              onGenerate={onGenerateInsight}
              loading={aiLoading}
            />
          </aside>
        </div>
      </div>
      <MobileTodayView
        data={data}
        derived={derived}
        shortcuts={shortcuts}
        onShortcutTrigger={onShortcutTrigger}
        onConfigureShortcuts={onConfigureShortcuts}
        onCompleteReminder={onCompleteReminder}
        onSkipReminder={onSkipReminder}
        onToggleReminder={onToggleReminder}
        onDeleteEvent={onDeleteEvent}
        onEditEvent={onEditEvent}
        onOpenPhoto={onOpenPhoto}
      />
      <MobileEventDetailPopup
        event={detailEvent}
        onClose={() => setDetailEvent(null)}
        onDelete={onDeleteEvent}
        onEdit={onEditEvent}
        onOpenPhoto={onOpenPhoto}
      />
    </>
  );
}

function WeightEditForm({ weight, onSave, onCancel }) {
  const [weightKg, setWeightKg] = useState(String(weight.weightKg || ""));
  const [measuredAt, setMeasuredAt] = useState(localDateTimeValue(weight.measuredAt));
  const [note, setNote] = useState(weight.note || "");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        id: weight.id,
        petId: weight.petId,
        weightKg,
        measuredAt: new Date(measuredAt).toISOString(),
        note
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ledgerForm" onSubmit={submit}>
      <input value={weightKg} onChange={(event) => setWeightKg(event.target.value)} placeholder="体重 kg" inputMode="decimal" />
      <input type="datetime-local" value={measuredAt} onChange={(event) => setMeasuredAt(event.target.value)} />
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注" />
      <div className="ledgerFormActions">
        <button className="secondaryButton" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="secondaryButton" type="submit" disabled={saving}>
          {saving ? "保存中" : "保存体重"}
        </button>
      </div>
    </form>
  );
}

function WeightLedger({ weightRecords, editingWeight, onEdit, onSave, onCancel, onDelete }) {
  return (
    <section className="contentPanel">
      <div className="sectionHeading">
        <p>体重记录</p>
        <span>可修改 / 删除已有条目</span>
      </div>
      {editingWeight ? (
        <WeightEditForm key={editingWeight.id} weight={editingWeight} onSave={onSave} onCancel={onCancel} />
      ) : (
        <p className="mutedText ledgerHint">选择下方任意一条体重记录进行编辑。</p>
      )}
      <div className="ledgerList">
        {[...weightRecords].reverse().map((weight) => (
          <article className="ledgerItem" key={weight.id}>
            <div>
              <strong>{weight.weightKg} kg</strong>
              <span>{formatDateTime(weight.measuredAt)}{weight.note ? ` · ${weight.note}` : ""}</span>
            </div>
            <div className="ledgerActions">
              <button className="miniActionButton iconOnlyAction" type="button" onClick={() => onEdit(weight)} aria-label="编辑体重记录">
                <Pencil size={14} />
              </button>
              <button className="miniDangerButton iconOnlyAction" type="button" onClick={() => onDelete(weight)} aria-label="删除体重记录">
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ExpenseForm({ petId, editingExpense, onCreate, onUpdate, onCancelEdit }) {
  const [category, setCategory] = useState(editingExpense?.category || "FOOD");
  const [itemName, setItemName] = useState(editingExpense?.itemName || "");
  const [amount, setAmount] = useState(editingExpense ? String(Number(editingExpense.amountCents || 0) / 100) : "");
  const [purchasedAt, setPurchasedAt] = useState(localDateValue(editingExpense?.purchasedAt || new Date()));
  const [note, setNote] = useState(editingExpense?.note || "");
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(editingExpense);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        petId,
        category,
        itemName,
        amount,
        purchasedAt: new Date(`${purchasedAt}T12:00:00`).toISOString(),
        note
      };

      if (isEditing) {
        await onUpdate({ id: editingExpense.id, ...payload });
      } else {
        await onCreate(payload);
        setItemName("");
        setAmount("");
        setNote("");
        setPurchasedAt(localDateValue());
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ledgerForm" onSubmit={submit}>
      <select value={category} onChange={(event) => setCategory(event.target.value)}>
        {Object.entries(EXPENSE_CATEGORIES).map(([key, value]) => (
          <option key={key} value={key}>{value}</option>
        ))}
      </select>
      <input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="物品名称" />
      <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="金额" inputMode="decimal" />
      <input type="date" value={purchasedAt} onChange={(event) => setPurchasedAt(event.target.value)} />
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注" />
      <div className="ledgerFormActions">
        {isEditing ? (
          <button className="secondaryButton" type="button" onClick={onCancelEdit}>
            取消
          </button>
        ) : null}
        <button className="secondaryButton" type="submit" disabled={saving}>
          <CircleDollarSign size={16} />
          {saving ? "保存中" : isEditing ? "保存费用" : "记一笔"}
        </button>
      </div>
    </form>
  );
}

function SubpageTop({ title, subtitle, onBack }) {
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

function SectionMenuCard({ icon: Icon, title, subtitle, meta, onClick }) {
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

function InsightsView({ data, derived, onCreateExpense, onUpdateExpense, onDeleteExpense, onUpdateWeight, onDeleteWeight }) {
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingWeightId, setEditingWeightId] = useState(null);
  const [section, setSection] = useState("home");
  const editingExpense = data.expenses.find((expense) => expense.id === editingExpenseId) || null;
  const editingWeight = derived.weightRecords.find((weight) => weight.id === editingWeightId) || null;
  const latestInsight = data.insights[0];

  async function saveWeight(payload) {
    await onUpdateWeight(payload);
    setEditingWeightId(null);
  }

  async function updateExpense(payload) {
    await onUpdateExpense(payload);
    setEditingExpenseId(null);
  }

  return (
    <section className="singleColumn insightWorkspace">
      {section === "home" ? (
        <>
          <div className="pageHeader">
            <div>
              <h2>成长洞察</h2>
              <p>先看趋势，再进入体重、费用或 AI 建议的具体页面。</p>
            </div>
          </div>
          <div className="sectionMenuGrid">
            <SectionMenuCard
              icon={LineChart}
              title="体重记录"
              subtitle="查看趋势并修改已有条目"
              meta={derived.latestWeight ? `${derived.latestWeight.weightKg}kg` : "未记录"}
              onClick={() => setSection("weight")}
            />
            <SectionMenuCard
              icon={CircleDollarSign}
              title="费用记录"
              subtitle="新增、编辑和删除消费"
              meta={formatCurrency(derived.expenseSummary.totalCents)}
              onClick={() => setSection("expense")}
            />
            <SectionMenuCard
              icon={Sparkles}
              title="AI 建议"
              subtitle={latestInsight ? latestInsight.title : "暂无建议历史"}
              meta={`${data.insights.length} 条`}
              onClick={() => setSection("ai")}
            />
          </div>
          <div className="chartGrid">
            <WeightChart weightRecords={derived.weightRecords} />
            <ExpenseChart expenses={data.expenses} />
          </div>
        </>
      ) : null}

      {section === "weight" ? (
        <>
        <SubpageTop title="体重记录" subtitle="编辑或删除既有体重条目" onBack={() => setSection("home")} />
        <WeightLedger
          weightRecords={derived.weightRecords}
          editingWeight={editingWeight}
          onEdit={(weight) => setEditingWeightId(weight.id)}
          onSave={saveWeight}
          onCancel={() => setEditingWeightId(null)}
          onDelete={onDeleteWeight}
        />
        </>
      ) : null}

      {section === "expense" ? (
      <>
      <SubpageTop title="费用记录" subtitle={`${formatCurrency(derived.expenseSummary.totalCents)} 累计`} onBack={() => setSection("home")} />
      <section className="contentPanel">
        <div className="sectionHeading">
          <p>费用记录</p>
          <span>{formatCurrency(derived.expenseSummary.totalCents)} 累计，可修改 / 删除</span>
        </div>
        <ExpenseForm
          key={editingExpense?.id || "new-expense"}
          petId={data.pet.id}
          editingExpense={editingExpense}
          onCreate={onCreateExpense}
          onUpdate={updateExpense}
          onCancelEdit={() => setEditingExpenseId(null)}
        />
        <div className="expenseList">
          {data.expenses.map((expense) => (
            <article key={expense.id}>
              <div>
                <strong>{expense.itemName}</strong>
                <span>
                  {EXPENSE_CATEGORIES[expense.category] || expense.category} · {formatDate(expense.purchasedAt)}
                  {expense.note ? ` · ${expense.note}` : ""}
                </span>
              </div>
              <div className="expenseAmountBlock">
                <b>{formatCurrency(expense.amountCents)}</b>
                <div className="ledgerActions">
                  <button className="miniActionButton iconOnlyAction" type="button" onClick={() => setEditingExpenseId(expense.id)} aria-label={`编辑费用 ${expense.itemName}`}>
                    <Pencil size={14} />
                  </button>
                  <button className="miniDangerButton iconOnlyAction" type="button" onClick={() => onDeleteExpense(expense)} aria-label={`删除费用 ${expense.itemName}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      </>
      ) : null}

      {section === "ai" ? (
      <>
      <SubpageTop title="AI 建议" subtitle="保守、可执行、可追踪" onBack={() => setSection("home")} />
      <section className="contentPanel">
        <div className="sectionHeading">
          <p>AI 建议历史</p>
          <span>保守、可执行、可追踪</span>
        </div>
        <div className="insightList">
          {data.insights.map((insight) => (
            <article key={insight.id}>
              <strong>{insight.title}</strong>
              <span>{formatDateTime(insight.generatedAt)}</span>
              <p>{insight.body}</p>
            </article>
          ))}
        </div>
      </section>
      </>
      ) : null}
    </section>
  );
}

function ReminderForm({ petId, onCreate }) {
  const [kind, setKind] = useState("FOOD");
  const [title, setTitle] = useState("");
  const [scheduledTime, setScheduledTime] = useState("08:00");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate({ petId, kind, title, scheduledTime });
      setTitle("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inlineForm" onSubmit={submit}>
      <select value={kind} onChange={(event) => setKind(event.target.value)}>
        {Object.entries(REMINDER_KINDS).map(([key, value]) => (
          <option key={key} value={key}>{value}</option>
        ))}
      </select>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="提醒内容" />
      <input type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} />
      <button className="secondaryButton" type="submit" disabled={saving}>
        <Bell size={16} />
        {saving ? "保存中" : "新增提醒"}
      </button>
    </form>
  );
}

function EventPresetSettings({ presets, onChange, onReset }) {
  const [draftLabel, setDraftLabel] = useState("");

  function updatePreset(id, patch) {
    onChange(presets.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (patch.label !== undefined) {
        next.label = sanitizeShortcutLabel(patch.label, item.label || "事件");
      }
      return next;
    }));
  }

  function addPreset() {
    const label = draftLabel.trim();
    if (!label) return;
    onChange([
      ...presets,
      {
        id: createEventPresetId(),
        enabled: false,
        label: sanitizeShortcutLabel(label),
        note: "",
        mode: "point"
      }
    ]);
    setDraftLabel("");
  }

  function deletePreset(preset) {
    const ok = window.confirm(`删除事件「${preset.label || "未命名"}」吗？`);
    if (!ok) return;
    onChange(presets.filter((item) => item.id !== preset.id));
  }

  return (
    <div className="eventPresetSettings">
      <div className="eventPresetComposer">
        <input
          value={draftLabel}
          onChange={(event) => setDraftLabel(event.target.value)}
          placeholder="新增事件，比如 晚餐"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addPreset();
            }
          }}
        />
        <button className="secondaryButton" type="button" onClick={addPreset}>
          <Plus size={16} />
          添加
        </button>
      </div>

      <div className="eventPresetList">
        <div className="eventPresetHeader" aria-hidden="true">
          <span>快捷</span>
          <span>事件名称</span>
          <span>单点 / 时段</span>
          <span>备注</span>
          <span />
        </div>
        {presets.map((preset) => {
          const mode = preset.mode === "range" ? "range" : "point";
          return (
            <article className={`eventPresetRow ${preset.enabled ? "quick" : ""}`} key={preset.id}>
              <label className="eventPresetQuick" title="是否显示到首页快捷事件">
                <input
                  type="checkbox"
                  checked={Boolean(preset.enabled)}
                  onChange={(event) => updatePreset(preset.id, { enabled: event.target.checked })}
                />
                <span>快捷</span>
              </label>
              <input
                className="eventPresetName"
                value={preset.label}
                onChange={(event) => updatePreset(preset.id, { label: event.target.value })}
                placeholder="事件名"
              />
              <div className="shortcutModeSwitch eventPresetMode" aria-label={`${preset.label || "事件"} 时间类型`}>
                <button
                  className={mode === "point" ? "selected" : ""}
                  type="button"
                  onClick={() => updatePreset(preset.id, { mode: "point" })}
                >
                  单点
                </button>
                <button
                  className={mode === "range" ? "selected" : ""}
                  type="button"
                  onClick={() => updatePreset(preset.id, { mode: "range" })}
                >
                  时段
                </button>
              </div>
              <input
                className="eventPresetNote"
                value={preset.note}
                onChange={(event) => updatePreset(preset.id, { note: event.target.value.slice(0, 80) })}
                placeholder="备注"
              />
              <button className="miniDangerButton iconOnlyAction" type="button" onClick={() => deletePreset(preset)} aria-label={`删除事件 ${preset.label || ""}`}>
                <Trash2 size={15} />
              </button>
            </article>
          );
        })}
      </div>

      <div className="eventPresetFooter">
        <span>勾选“快捷”的事件会出现在时间轴首页；点快捷后会打开预填好的新增表单。</span>
        <button className="secondaryButton" type="button" onClick={onReset}>
          恢复默认
        </button>
      </div>
    </div>
  );
}

function ProfileForm({ pet, onSave }) {
  const avatarInputRef = useRef(null);
  const [form, setForm] = useState({
    name: pet.name,
    breed: pet.breed,
    sex: pet.sex,
    birthday: pet.birthday.slice(0, 10),
    avatarUrl: pet.avatarUrl || "",
    currentWeight: pet.currentWeight || "",
    notes: pet.notes || ""
  });
  const [saving, setSaving] = useState(false);
  const [avatarProcessing, setAvatarProcessing] = useState(false);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function selectAvatar(file) {
    if (!file) return;
    setAvatarProcessing(true);
    try {
      const dataUrl = await compressImageFile(file);
      update("avatarUrl", dataUrl);
      window.localStorage.setItem(APP_ICON_STORAGE_KEY, dataUrl);
      updateAppIconLinks(dataUrl);
    } finally {
      setAvatarProcessing(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ id: pet.id, ...form });
      if (form.avatarUrl) {
        window.localStorage.setItem(APP_ICON_STORAGE_KEY, form.avatarUrl);
        updateAppIconLinks(`/api/app-icon?size=192&v=${Date.now()}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="profileForm" onSubmit={submit}>
      <input
        ref={avatarInputRef}
        className="hiddenFileInput"
        type="file"
        accept="image/*"
        onChange={(event) => {
          selectAvatar(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="avatarConfigurator">
        <img src={form.avatarUrl || "/icons/petdaily-icon-192.png"} alt={`${form.name || pet.name} 桌面图标预览`} />
        <div>
          <strong>桌面快捷图标</strong>
          <span>保存后会更新当前浏览器图标和“添加到主屏幕”使用的图标；已经固定到桌面的旧图标通常需要删除后重新添加。</span>
          <button className="secondaryButton" type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarProcessing}>
            <Camera size={16} />
            {avatarProcessing ? "处理中" : "选择宠物图"}
          </button>
        </div>
      </div>
      <label>
        名字
        <input value={form.name} onChange={(event) => update("name", event.target.value)} />
      </label>
      <label>
        品种
        <input value={form.breed} onChange={(event) => update("breed", event.target.value)} />
      </label>
      <label>
        性别
        <select value={form.sex} onChange={(event) => update("sex", event.target.value)}>
          <option value="female">妹妹</option>
          <option value="male">弟弟</option>
        </select>
      </label>
      <label>
        生日
        <input type="date" value={form.birthday} onChange={(event) => update("birthday", event.target.value)} />
      </label>
      <label className="wideField">
        头像 / 快捷图标 URL
        <input value={form.avatarUrl} onChange={(event) => update("avatarUrl", event.target.value)} placeholder="/photos/westie-portrait.svg" />
      </label>
      <label>
        当前体重 kg
        <input value={form.currentWeight} onChange={(event) => update("currentWeight", event.target.value)} inputMode="decimal" />
      </label>
      <label className="wideField">
        养育备注
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} />
      </label>
      <button className="primaryButton full" type="submit" disabled={saving}>
        {saving ? "保存中..." : "保存档案"}
      </button>
    </form>
  );
}

function ProfileView({
  data,
  shortcuts,
  onShortcutsChange,
  onResetShortcuts,
  onSaveProfile,
  onCreateReminder,
  onCompleteReminder,
  onSkipReminder,
  onToggleReminder,
  onDeleteReminder
}) {
  const [section, setSection] = useState("home");
  const quickCount = shortcuts.filter((item) => item.enabled).length;
  const activeReminderCount = data.reminders.filter((item) => item.active).length;

  return (
    <section className="singleColumn settingsWorkspace">
      {section === "home" ? (
        <>
      <div className="pageHeader">
        <div>
          <h2>我的宠物</h2>
          <p>把设置拆成短页面，避免在手机上一路翻到底。</p>
        </div>
      </div>
      <div className="sectionMenuGrid">
        <SectionMenuCard
          icon={BookOpen}
          title="事件设置"
          subtitle="维护事件清单，并选择首页快捷入口"
          meta={`${shortcuts.length} 条 / ${quickCount} 快捷`}
          onClick={() => setSection("events")}
        />
        <SectionMenuCard
          icon={Bell}
          title="提醒计划"
          subtitle="新增、完成、暂停或删除提醒"
          meta={`${activeReminderCount} 启用`}
          onClick={() => setSection("reminders")}
        />
        <SectionMenuCard
          icon={Settings}
          title="档案与桌面图标"
          subtitle={data.pet.avatarUrl ? "已设置宠物图" : "使用默认图标"}
          meta={data.pet.name}
          onClick={() => setSection("profile")}
        />
      </div>
      </>
      ) : null}

      {section === "events" ? (
      <>
      <SubpageTop title="事件设置" subtitle="每一行就是一个可记录事件" onBack={() => setSection("home")} />
      <section className="contentPanel settingsSection">
        <div className="sectionHeading">
          <p>事件设置</p>
          <span>只保留快捷、名称、记录方式和备注</span>
        </div>
        <EventPresetSettings presets={shortcuts} onChange={onShortcutsChange} onReset={onResetShortcuts} />
      </section>
      </>
      ) : null}

      {section === "reminders" ? (
      <>
      <SubpageTop title="提醒计划" subtitle="常用提醒独立管理" onBack={() => setSection("home")} />
      <section className="contentPanel settingsSection">
        <div className="sectionHeading">
          <p>提醒计划</p>
          <span>可完成、暂停、删除，会同步到 D1</span>
        </div>
        <ReminderForm petId={data.pet.id} onCreate={onCreateReminder} />
        <ReminderList
          reminders={data.reminders}
          onComplete={onCompleteReminder}
          onSkip={onSkipReminder}
          onToggle={onToggleReminder}
          onDelete={onDeleteReminder}
        />
      </section>
      </>
      ) : null}

      {section === "profile" ? (
        <>
          <SubpageTop title="档案与桌面图标" subtitle="换宠物图后重新添加主屏幕即可使用新图标" onBack={() => setSection("home")} />
          <section className="contentPanel settingsSection">
            <div className="sectionHeading">
              <p>宠物档案</p>
              <span>第一版支持一只宠物</span>
            </div>
            <ProfileForm pet={data.pet} onSave={onSaveProfile} />
          </section>
          <section className="syncPanel">
            <div>
              <strong>Cloudflare 同步预留</strong>
              <p>结构化数据将迁移到 D1，照片迁移到 R2，前端可部署到 Pages；当前本地 SQLite 保持同一业务模型。</p>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

export default function PetDailyApp({ initialData }) {
  const [activeTab, setActiveTab] = useState("today");
  const [data, setData] = useState(initialData);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPresetId, setSheetPresetId] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false);
  const [eventShortcuts, setEventShortcuts] = useState(defaultEventShortcuts);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const derived = useMemo(() => getDerivedData(data), [data]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
      const legacy = window.localStorage.getItem(LEGACY_SHORTCUT_STORAGE_KEY);
      if (stored) {
        setEventShortcuts(normalizeShortcuts(JSON.parse(stored)));
      } else if (legacy) {
        const normalized = normalizeShortcuts(JSON.parse(legacy));
        setEventShortcuts(normalized);
        window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(normalized));
      } else {
        setEventShortcuts(defaultEventShortcuts);
      }
    } catch {
      setEventShortcuts(defaultEventShortcuts);
    } finally {
      setShortcutsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!shortcutsLoaded) return;
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(eventShortcuts));
  }, [eventShortcuts, shortcutsLoaded]);

  useEffect(() => {
    const storedIcon = window.localStorage.getItem(APP_ICON_STORAGE_KEY);
    const iconUrl = storedIcon || data.pet?.avatarUrl;
    if (iconUrl) updateAppIconLinks(iconUrl);
  }, [data.pet?.avatarUrl]);

  useEffect(() => {
    function handleShortcutKey(event) {
      if (!data.pet) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const keyNumber = Number(event.key);
      if (!Number.isInteger(keyNumber) || keyNumber < 1 || keyNumber > 9) return;
      const shortcut = eventShortcuts.filter((item) => item.enabled && item.label?.trim())[keyNumber - 1];
      if (!shortcut) return;
      event.preventDefault();
      openQuickRecord(shortcut.id);
    }

    window.addEventListener("keydown", handleShortcutKey);
    return () => window.removeEventListener("keydown", handleShortcutKey);
  }, [data.pet, eventShortcuts]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const inputTypesWithoutKeyboard = new Set(["checkbox", "radio", "file", "color", "range", "hidden", "button", "submit"]);

    function isKeyboardTarget(element) {
      if (!element) return false;
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
      if (element instanceof HTMLInputElement) return !inputTypesWithoutKeyboard.has(element.type);
      return Boolean(element.isContentEditable);
    }

    function syncKeyboardState() {
      const focused = isKeyboardTarget(document.activeElement);
      const viewportHeight = visualViewport?.height || window.innerHeight;
      const isCompressed = window.innerHeight - viewportHeight > 120;
      const isMobileWidth = window.matchMedia("(max-width: 980px)").matches;
      setKeyboardOpen(focused && (isMobileWidth || isCompressed));
    }

    function deferSyncKeyboardState() {
      window.setTimeout(syncKeyboardState, 80);
    }

    window.addEventListener("focusin", syncKeyboardState);
    window.addEventListener("focusout", deferSyncKeyboardState);
    visualViewport?.addEventListener("resize", syncKeyboardState);
    visualViewport?.addEventListener("scroll", syncKeyboardState);
    return () => {
      window.removeEventListener("focusin", syncKeyboardState);
      window.removeEventListener("focusout", deferSyncKeyboardState);
      visualViewport?.removeEventListener("resize", syncKeyboardState);
      visualViewport?.removeEventListener("scroll", syncKeyboardState);
    };
  }, []);

  if (!data.pet) {
    return <EmptyState />;
  }

  async function createTimeline(payload) {
    const response = await fetch("/api/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to create timeline event");
    const { event, weightRecord, photoAsset } = await response.json();

    setData((current) => {
      const next = {
        ...current,
        timelineEvents: [event, ...current.timelineEvents]
      };
      if (payload.type === "WEIGHT" && payload.amount) {
        const nextWeightRecord = weightRecord || {
          id: `local-${event.id}`,
          petId: payload.petId,
          measuredAt: event.happenedAt,
          weightKg: Number(payload.amount),
          note: payload.note,
          createdAt: event.createdAt
        };
        next.weightRecords = sortWeightRecords([...current.weightRecords, nextWeightRecord]);
        next.pet = { ...current.pet, currentWeight: Number(payload.amount) };
      }
      if (payload.photoUrl) {
        const nextPhoto = photoAsset || {
            id: `local-photo-${event.id}`,
            petId: payload.petId,
            url: payload.photoUrl,
            caption: payload.title,
            takenAt: event.happenedAt,
            linkedEventId: event.id,
            createdAt: event.createdAt
          };
        next.photos = [nextPhoto, ...current.photos];
      }
      return next;
    });
  }

  function appendTimelineEvent(event) {
    if (!event) return;
    setData((current) => ({
      ...current,
      timelineEvents: current.timelineEvents.some((item) => item.id === event.id)
        ? current.timelineEvents
        : [event, ...current.timelineEvents]
    }));
  }

  function openQuickRecord(presetId = null) {
    setSheetPresetId(presetId);
    setSheetOpen(true);
  }

  async function deleteTimeline(event) {
    const ok = window.confirm(`删除「${event.title}」这条记录吗？`);
    if (!ok) return;

    const response = await fetch(`/api/timeline?id=${encodeURIComponent(event.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Failed to delete timeline event");

    setData((current) => {
      const nextTimeline = current.timelineEvents.filter((item) => item.id !== event.id);
      const nextPhotos = current.photos.filter((photo) => photo.linkedEventId !== event.id);
      let nextWeightRecords = current.weightRecords;
      let nextPet = current.pet;

      if (event.type === "WEIGHT") {
        nextWeightRecords = current.weightRecords.filter(
          (item) =>
            !(
              item.petId === event.petId &&
              item.measuredAt === event.happenedAt &&
              Number(item.weightKg) === Number(event.amount)
            )
        );
        const latest = [...nextWeightRecords].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)).at(-1);
        nextPet = { ...current.pet, currentWeight: latest?.weightKg ?? null };
      }

      return {
        ...current,
        pet: nextPet,
        timelineEvents: nextTimeline,
        photos: nextPhotos,
        weightRecords: nextWeightRecords
      };
    });
  }

  async function onEditTimeline(payload) {
    const response = await fetch("/api/timeline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to update timeline event");
    const { event, weightRecord, currentWeightKg } = await response.json();
    setData((current) => ({
      ...current,
      pet: currentWeightKg == null ? current.pet : { ...current.pet, currentWeight: currentWeightKg },
      weightRecords: weightRecord
        ? sortWeightRecords(current.weightRecords.map((item) => (item.id === weightRecord.id ? weightRecord : item)))
        : current.weightRecords,
      timelineEvents: current.timelineEvents.map((item) => (item.id === event.id ? event : item))
    }));
    return event;
  }

  async function createExpense(payload) {
    const response = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to create expense");
    const { expense } = await response.json();
    setData((current) => ({ ...current, expenses: sortExpenses([expense, ...current.expenses]) }));
  }

  async function updateExpense(payload) {
    const response = await fetch("/api/expenses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to update expense");
    const { expense } = await response.json();
    setData((current) => ({
      ...current,
      expenses: sortExpenses(current.expenses.map((item) => (item.id === expense.id ? expense : item)))
    }));
  }

  async function deleteExpenseItem(expense) {
    const ok = window.confirm(`删除费用「${expense.itemName}」吗？`);
    if (!ok) return;

    const response = await fetch(`/api/expenses?id=${encodeURIComponent(expense.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Failed to delete expense");
    setData((current) => ({
      ...current,
      expenses: current.expenses.filter((item) => item.id !== expense.id)
    }));
  }

  async function updateWeight(payload) {
    const response = await fetch("/api/weights", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to update weight");
    const { weight, timelineEvent, currentWeightKg } = await response.json();
    setData((current) => ({
      ...current,
      pet: { ...current.pet, currentWeight: currentWeightKg },
      weightRecords: sortWeightRecords(current.weightRecords.map((item) => (item.id === weight.id ? weight : item))),
      timelineEvents: timelineEvent
        ? current.timelineEvents.map((item) => (item.id === timelineEvent.id ? timelineEvent : item))
        : current.timelineEvents
    }));
  }

  async function deleteWeightItem(weight) {
    const ok = window.confirm(`删除 ${formatDateTime(weight.measuredAt)} 的体重记录吗？`);
    if (!ok) return;

    const response = await fetch(`/api/weights?id=${encodeURIComponent(weight.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Failed to delete weight");
    const { result } = await response.json();
    const deletedTimelineIds = new Set(result.timelineEventIds || []);

    setData((current) => ({
      ...current,
      pet: { ...current.pet, currentWeight: result.currentWeightKg },
      weightRecords: current.weightRecords.filter((item) => item.id !== weight.id),
      timelineEvents: current.timelineEvents.filter((item) => !deletedTimelineIds.has(item.id))
    }));
  }

  async function createReminder(payload) {
    const response = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to create reminder");
    const { reminder } = await response.json();
    setData((current) => ({ ...current, reminders: [...current.reminders, reminder] }));
  }

  async function toggleReminder(reminder) {
    const response = await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reminder.id, active: !reminder.active })
    });
    if (!response.ok) throw new Error("Failed to update reminder");
    const { reminder: updated } = await response.json();
    setData((current) => ({
      ...current,
      reminders: current.reminders.map((item) => (item.id === updated.id ? updated : item))
    }));
  }

  async function completeReminder(reminder) {
    const status = getReminderStatus(reminder);
    const response = await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reminder.id,
        complete: status.key !== "done",
        resetDone: status.key === "done"
      })
    });
    if (!response.ok) throw new Error("Failed to complete reminder");
    const { reminder: updated } = await response.json();
    setData((current) => ({
      ...current,
      reminders: current.reminders.map((item) => (item.id === updated.id ? updated : item))
    }));
  }

  async function skipReminder(reminder) {
    const status = getReminderStatus(reminder);
    const response = await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reminder.id,
        skip: status.key !== "skipped",
        resetSkip: status.key === "skipped"
      })
    });
    if (!response.ok) throw new Error("Failed to skip reminder");
    const { reminder: updated } = await response.json();
    setData((current) => ({
      ...current,
      reminders: current.reminders.map((item) => (item.id === updated.id ? updated : item))
    }));
  }

  async function deleteReminderItem(reminder) {
    const ok = window.confirm(`删除提醒「${reminder.title}」吗？`);
    if (!ok) return;

    const response = await fetch(`/api/reminders?id=${encodeURIComponent(reminder.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Failed to delete reminder");
    setData((current) => ({
      ...current,
      reminders: current.reminders.filter((item) => item.id !== reminder.id)
    }));
  }

  async function saveProfile(payload) {
    const response = await fetch("/api/pets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to save profile");
    const { pet } = await response.json();
    setData((current) => ({ ...current, pet }));
  }

  async function generateInsight() {
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ petId: data.pet.id })
      });
      if (!response.ok) throw new Error("Failed to generate insight");
      const { insight } = await response.json();
      setData((current) => ({ ...current, insights: [insight, ...current.insights] }));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <ConfigProvider locale={zhCN}>
    <div className={`appShell ${keyboardOpen ? "keyboardOpen" : ""}`}>
      <aside className="desktopRail">
        <div className="brandLockup">
          <span><Dog size={20} /></span>
          <strong>PetDaily</strong>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              selected={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </nav>
      </aside>

      <main className="appMain">
        {activeTab === "today" ? (
          <TodayView
            data={data}
            derived={derived}
            shortcuts={eventShortcuts}
            onShortcutTrigger={(shortcut) => openQuickRecord(shortcut.id)}
            onConfigureShortcuts={() => setActiveTab("profile")}
            onGenerateInsight={generateInsight}
            aiLoading={aiLoading}
            onCompleteReminder={completeReminder}
            onSkipReminder={skipReminder}
            onToggleReminder={toggleReminder}
            onDeleteEvent={deleteTimeline}
            onEditEvent={onEditTimeline}
            onOpenPhoto={setLightboxPhoto}
          />
        ) : null}
        {activeTab === "bark" ? (
          <BarkMonitorPanel pet={data.pet} timelineEvents={derived.timelineEvents} onTimelineCreated={appendTimelineEvent} />
        ) : null}
        {activeTab === "insights" ? (
          <InsightsView
            data={data}
            derived={derived}
            onCreateExpense={createExpense}
            onUpdateExpense={updateExpense}
            onDeleteExpense={deleteExpenseItem}
            onUpdateWeight={updateWeight}
            onDeleteWeight={deleteWeightItem}
          />
        ) : null}
        {activeTab === "profile" ? (
          <ProfileView
            data={data}
            shortcuts={eventShortcuts}
            onShortcutsChange={setEventShortcuts}
            onResetShortcuts={() => setEventShortcuts(defaultEventShortcuts)}
            onSaveProfile={saveProfile}
            onCreateReminder={createReminder}
            onCompleteReminder={completeReminder}
            onSkipReminder={skipReminder}
            onToggleReminder={toggleReminder}
            onDeleteReminder={deleteReminderItem}
          />
        ) : null}
      </main>

      <button className="floatingAddButton desktopAddButton" type="button" onClick={() => openQuickRecord()} aria-label="新增事件">
        <Plus size={24} />
      </button>

      <FloatingBubble
        className="mobileAddBubble"
        axis="lock"
        onClick={() => openQuickRecord()}
        style={{
          "--initial-position-right": "12px",
          "--initial-position-bottom": "78px",
          "--z-index": "32",
          "--size": "50px",
          "--background": "var(--text)"
        }}
      >
        <Plus size={24} />
      </FloatingBubble>

      <nav className="mobileNav admMobileNav" aria-label="主导航">
        <TabBar activeKey={activeTab} onChange={setActiveTab} safeArea>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <TabBar.Item
                key={item.id}
                icon={(active) => <Icon size={active ? 20 : 19} strokeWidth={active ? 2.5 : 2} />}
                title={item.label}
              />
            );
          })}
        </TabBar>
      </nav>

      <QuickRecordSheet
        open={sheetOpen}
        petId={data.pet.id}
        eventPresets={eventShortcuts}
        selectedPresetId={sheetPresetId}
        onClose={() => {
          setSheetOpen(false);
          setSheetPresetId(null);
        }}
        onCreate={createTimeline}
      />
      <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
    </div>
    </ConfigProvider>
  );
}
