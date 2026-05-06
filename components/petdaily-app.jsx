"use client";

import { useMemo, useRef, useState } from "react";
import {
  Bell,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Dog,
  HeartPulse,
  Home,
  ImagePlus,
  LineChart,
  PauseCircle,
  Pencil,
  PawPrint,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Syringe,
  Trash2,
  Upload,
  Utensils
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ExpenseChart, WeightChart } from "@/components/charts-panel";
import { compressImageFile } from "@/components/image-file";
import QuickRecordSheet from "@/components/quick-record-sheet";
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
  { id: "record", label: "记录", icon: BookOpen },
  { id: "insights", label: "洞察", icon: LineChart },
  { id: "photos", label: "相册", icon: Camera },
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
  NOTE: BookOpen
};

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
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
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

function getDerivedData(data) {
  const timelineEvents = [...data.timelineEvents].sort(
    (a, b) => new Date(b.happenedAt) - new Date(a.happenedAt)
  );
  const weightRecords = [...data.weightRecords].sort(
    (a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)
  );
  const todayStart = getTodayStart();
  const todayEvents = timelineEvents.filter((event) => new Date(event.happenedAt) >= todayStart);
  const latestWeight = weightRecords.at(-1);
  const previousWeight = weightRecords.at(-2);
  const expenseSummary = getExpenseSummary(data.expenses);

  return {
    timelineEvents,
    weightRecords,
    todayEvents,
    latestWeight,
    weightDelta:
      latestWeight && previousWeight
        ? Number((latestWeight.weightKg - previousWeight.weightKg).toFixed(2))
        : null,
    activeReminders: data.reminders.filter((item) => item.active && !isSameDay(item.lastDoneAt)),
    expenseSummary
  };
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

function TimelineList({ events, compact = false, onDelete }) {
  if (!events.length) {
    return <p className="mutedText">还没有记录。先从喂食、如厕或体重开始。</p>;
  }

  return (
    <div className={`timelineList ${compact ? "compact" : ""}`}>
      {events.map((event) => {
        const Icon = eventIcons[event.type] || BookOpen;
        const meta = EVENT_TYPES[event.type] || EVENT_TYPES.NOTE;
        return (
          <article className={`timelineItem tone-${meta.tone}`} key={event.id}>
            <div className="timelineIcon">
              <Icon size={17} />
            </div>
            <div>
              <div className="timelineTopline">
                <strong>{event.title}</strong>
                <span>{formatDateTime(event.happenedAt)}</span>
                {onDelete ? (
                  <button className="miniDangerButton" type="button" onClick={() => onDelete(event)}>
                    <Trash2 size={15} />
                    <span>删除</span>
                  </button>
                ) : null}
              </div>
              {event.amount ? (
                <p className="eventAmount">
                  {event.amount}
                  {event.unit || meta.unit}
                </p>
              ) : null}
              {event.note ? <p>{event.note}</p> : null}
              {event.photoUrl ? <img className="timelinePhoto" src={event.photoUrl} alt={event.title} /> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TimelineStream({ events, onDelete }) {
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
                      {onDelete ? (
                        <button className="miniDangerButton" type="button" onClick={() => onDelete(event)}>
                          <Trash2 size={15} />
                          删除
                        </button>
                      ) : null}
                    </div>
                    {event.note ? <p>{event.note}</p> : null}
                    {event.photoUrl ? <img className="timelineEntryPhoto" src={event.photoUrl} alt={event.title} /> : null}
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

function ReminderList({ reminders, onComplete, onToggle, onDelete }) {
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

function TodayView({
  data,
  derived,
  onOpenRecord,
  onGenerateInsight,
  aiLoading,
  onCompleteReminder,
  onToggleReminder,
  onDeleteEvent
}) {
  const { pet, localCoach, insights } = data;
  const [typeFilter, setTypeFilter] = useState("ALL");
  const latestInsight = insights[0];
  const filteredEvents = useMemo(
    () =>
      typeFilter === "ALL"
        ? derived.timelineEvents
        : derived.timelineEvents.filter((event) => event.type === typeFilter),
    [derived.timelineEvents, typeFilter]
  );

  return (
    <div className="timelineWorkspace">
      <section className="timelineCommandBar">
        <div>
          <h1>时间轴</h1>
          <p>按发生时间持续记录事件，最近的变化始终排在最前。</p>
        </div>
        <button className="primaryButton" type="button" onClick={onOpenRecord}>
          <Plus size={18} />
          新增事件
        </button>
      </section>

      <div className="timelineLayout">
        <section className="timelinePanel">
          <div className="timelineToolbar">
            <div>
              <p>事件流</p>
              <span>{filteredEvents.length} 条记录</span>
            </div>
            <div className="timelineFilterStrip" aria-label="时间轴筛选">
              <button
                className={`filterChip ${typeFilter === "ALL" ? "selected" : ""}`}
                type="button"
                onClick={() => setTypeFilter("ALL")}
              >
                全部
              </button>
              {Object.entries(EVENT_TYPES).map(([key, value]) => (
                <button
                  className={`filterChip ${typeFilter === key ? "selected" : ""}`}
                  type="button"
                  key={key}
                  onClick={() => setTypeFilter(key)}
                >
                  {value.label}
                </button>
              ))}
            </div>
          </div>
          <TimelineStream events={filteredEvents} onDelete={onDeleteEvent} />
        </section>

        <aside className="timelineAside">
          <section className="contentPanel compactPanel">
            <div className="sectionHeading">
              <p>待办提醒</p>
              <span>完成 / 暂停</span>
            </div>
            <ReminderList reminders={data.reminders.slice(0, 5)} onComplete={onCompleteReminder} onToggle={onToggleReminder} />
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
  );
}

function RecordView({ events, onOpenRecord, onDeleteEvent }) {
  return (
    <section className="singleColumn">
      <div className="pageHeader">
        <div>
          <h2>时间日记</h2>
          <p>饮食、排便、如厕、疫苗、驱虫和成长观察都沉淀在同一条时间线。</p>
        </div>
        <button className="primaryButton" type="button" onClick={onOpenRecord}>
          <Plus size={18} />
          新增记录
        </button>
      </div>
      <div className="typeLegend">
        {Object.entries(EVENT_TYPES).map(([key, value]) => (
          <span className={`legendPill tone-${value.tone}`} key={key}>{value.label}</span>
        ))}
      </div>
      <TimelineList events={events} onDelete={onDeleteEvent} />
    </section>
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
              <span>{formatDateTime(weight.measuredAt)}</span>
              {weight.note ? <small>{weight.note}</small> : null}
            </div>
            <div className="ledgerActions">
              <button className="miniActionButton" type="button" onClick={() => onEdit(weight)}>
                <Pencil size={14} />
                编辑
              </button>
              <button className="miniDangerButton" type="button" onClick={() => onDelete(weight)}>
                <Trash2 size={15} />
                删除
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

function InsightsView({ data, derived, onCreateExpense, onUpdateExpense, onDeleteExpense, onUpdateWeight, onDeleteWeight }) {
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingWeightId, setEditingWeightId] = useState(null);
  const editingExpense = data.expenses.find((expense) => expense.id === editingExpenseId) || null;
  const editingWeight = derived.weightRecords.find((weight) => weight.id === editingWeightId) || null;

  async function saveWeight(payload) {
    await onUpdateWeight(payload);
    setEditingWeightId(null);
  }

  async function updateExpense(payload) {
    await onUpdateExpense(payload);
    setEditingExpenseId(null);
  }

  return (
    <section className="singleColumn">
      <div className="pageHeader">
        <div>
          <h2>成长洞察</h2>
          <p>用图表检查体重趋势、费用结构和 AI 建议，帮助你发现日常节奏。</p>
        </div>
      </div>
      <div className="chartGrid">
        <WeightChart weightRecords={derived.weightRecords} />
        <ExpenseChart expenses={data.expenses} />
      </div>
      <WeightLedger
        weightRecords={derived.weightRecords}
        editingWeight={editingWeight}
        onEdit={(weight) => setEditingWeightId(weight.id)}
        onSave={saveWeight}
        onCancel={() => setEditingWeightId(null)}
        onDelete={onDeleteWeight}
      />
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
                <span>{EXPENSE_CATEGORIES[expense.category] || expense.category} · {formatDate(expense.purchasedAt)}</span>
                {expense.note ? <small>{expense.note}</small> : null}
              </div>
              <div className="expenseAmountBlock">
                <b>{formatCurrency(expense.amountCents)}</b>
                <div className="ledgerActions">
                  <button className="miniActionButton" type="button" onClick={() => setEditingExpenseId(expense.id)}>
                    <Pencil size={14} />
                    编辑
                  </button>
                  <button className="miniDangerButton" type="button" onClick={() => onDeleteExpense(expense)}>
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
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
    </section>
  );
}

function PhotoForm({ petId, onCreate }) {
  const cameraInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function selectFile(file) {
    if (!file) return;
    setProcessing(true);
    try {
      const dataUrl = await compressImageFile(file);
      setUrl(dataUrl);
      setPreview(dataUrl);
      if (!caption) {
        setCaption("手机拍摄记录");
      }
    } finally {
      setProcessing(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!url) return;
    setSaving(true);
    try {
      await onCreate({ petId, url, caption });
      setCaption("");
      setUrl("");
      setPreview("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="photoCaptureForm" onSubmit={submit}>
      <input
        ref={cameraInputRef}
        className="hiddenFileInput"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      <input
        ref={albumInputRef}
        className="hiddenFileInput"
        type="file"
        accept="image/*"
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      <div className="photoPickers">
        <button className="secondaryButton" type="button" onClick={() => cameraInputRef.current?.click()} disabled={processing}>
          <Camera size={16} />
          手机拍摄
        </button>
        <button className="secondaryButton" type="button" onClick={() => albumInputRef.current?.click()} disabled={processing}>
          <Upload size={16} />
          读取相册
        </button>
      </div>
      {preview ? <img className="photoPreview" src={preview} alt="待保存照片预览" /> : null}
      <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="照片说明，例如：第一次洗澡后" />
      <input value={url} onChange={(event) => { setUrl(event.target.value); setPreview(event.target.value); }} placeholder="也可粘贴图片 URL 或未来 R2 URL" />
      <button className="secondaryButton" type="submit" disabled={saving}>
        <ImagePlus size={16} />
        {saving ? "保存中" : processing ? "处理中" : "加入相册"}
      </button>
    </form>
  );
}

function PhotosView({ data, onCreatePhoto, onDeletePhoto }) {
  return (
    <section className="singleColumn">
      <div className="pageHeader">
        <div>
          <h2>成长相册</h2>
          <p>手机端可直接拍摄或读取相册，当前会压缩后同步到 Cloudflare D1；照片多了以后再迁到 R2。</p>
        </div>
      </div>
      <PhotoForm petId={data.pet.id} onCreate={onCreatePhoto} />
      <div className="photoGrid">
        {data.photos.map((photo) => (
          <article className="photoCard" key={photo.id}>
            <img src={photo.url} alt={photo.caption || "宠物照片"} />
            <div>
              <strong>{photo.caption || "成长照片"}</strong>
              <span>{formatDate(photo.takenAt)}</span>
              <button className="miniDangerButton" type="button" onClick={() => onDeletePhoto(photo)}>
                <Trash2 size={15} />
                删除照片
              </button>
            </div>
          </article>
        ))}
      </div>
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

function ProfileForm({ pet, onSave }) {
  const [form, setForm] = useState({
    name: pet.name,
    breed: pet.breed,
    sex: pet.sex,
    birthday: pet.birthday.slice(0, 10),
    currentWeight: pet.currentWeight || "",
    notes: pet.notes || ""
  });
  const [saving, setSaving] = useState(false);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ id: pet.id, ...form });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="profileForm" onSubmit={submit}>
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

function ProfileView({ data, onSaveProfile, onCreateReminder, onCompleteReminder, onToggleReminder, onDeleteReminder }) {
  return (
    <section className="singleColumn">
      <div className="pageHeader">
        <div>
          <h2>我的宠物</h2>
          <p>维护基础档案、提醒计划和后续 Cloudflare 同步边界。</p>
        </div>
      </div>
      <section className="contentPanel">
        <div className="sectionHeading">
          <p>宠物档案</p>
          <span>第一版支持一只宠物</span>
        </div>
        <ProfileForm pet={data.pet} onSave={onSaveProfile} />
      </section>
      <section className="contentPanel">
        <div className="sectionHeading">
          <p>提醒计划</p>
          <span>可完成、暂停、删除，会同步到 D1</span>
        </div>
        <ReminderForm petId={data.pet.id} onCreate={onCreateReminder} />
        <ReminderList
          reminders={data.reminders}
          onComplete={onCompleteReminder}
          onToggle={onToggleReminder}
          onDelete={onDeleteReminder}
        />
      </section>
      <section className="syncPanel">
        <div>
          <strong>Cloudflare 同步预留</strong>
          <p>结构化数据将迁移到 D1，照片迁移到 R2，前端可部署到 Pages；当前本地 SQLite 保持同一业务模型。</p>
        </div>
      </section>
    </section>
  );
}

export default function PetDailyApp({ initialData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("today");
  const [data, setData] = useState(initialData);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const derived = useMemo(() => getDerivedData(data), [data]);

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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
  }

  async function createPhoto(payload) {
    const response = await fetch("/api/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Failed to create photo");
    const { photo } = await response.json();
    setData((current) => ({ ...current, photos: [photo, ...current.photos] }));
    router.refresh();
  }

  async function deletePhoto(photo) {
    const ok = window.confirm(`删除「${photo.caption || "成长照片"}」吗？`);
    if (!ok) return;

    const response = await fetch(`/api/photos?id=${encodeURIComponent(photo.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Failed to delete photo");
    const { result } = await response.json();

    setData((current) => ({
      ...current,
      photos: current.photos.filter((item) => item.id !== photo.id),
      timelineEvents: result.linkedEventId
        ? current.timelineEvents.filter((item) => item.id !== result.linkedEventId)
        : current.timelineEvents
    }));
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
      router.refresh();
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="appShell">
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
            onOpenRecord={() => setSheetOpen(true)}
            onGenerateInsight={generateInsight}
            aiLoading={aiLoading}
            onCompleteReminder={completeReminder}
            onToggleReminder={toggleReminder}
            onDeleteEvent={deleteTimeline}
          />
        ) : null}
        {activeTab === "record" ? (
          <RecordView events={derived.timelineEvents} onOpenRecord={() => setSheetOpen(true)} onDeleteEvent={deleteTimeline} />
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
        {activeTab === "photos" ? (
          <PhotosView data={data} onCreatePhoto={createPhoto} onDeletePhoto={deletePhoto} />
        ) : null}
        {activeTab === "profile" ? (
          <ProfileView
            data={data}
            onSaveProfile={saveProfile}
            onCreateReminder={createReminder}
            onCompleteReminder={completeReminder}
            onToggleReminder={toggleReminder}
            onDeleteReminder={deleteReminderItem}
          />
        ) : null}
      </main>

      <nav className="mobileNav" aria-label="主导航">
        {navItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            selected={activeTab === item.id}
            onClick={() => setActiveTab(item.id)}
          />
        ))}
      </nav>

      <QuickRecordSheet
        open={sheetOpen}
        petId={data.pet.id}
        onClose={() => setSheetOpen(false)}
        onCreate={createTimeline}
      />
    </div>
  );
}
