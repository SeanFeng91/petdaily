"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  BookOpen,
  Camera,
  Check,
  CircleDollarSign,
  Dog,
  HeartPulse,
  Home,
  ImagePlus,
  LineChart,
  PawPrint,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Syringe,
  Utensils
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ExpenseChart, WeightChart } from "@/components/charts-panel";
import QuickRecordSheet from "@/components/quick-record-sheet";
import {
  EVENT_TYPES,
  EXPENSE_CATEGORIES,
  REMINDER_KINDS,
  formatCurrency,
  formatDate,
  formatDateTime,
  getAgeText
} from "@/lib/domain";

const navItems = [
  { id: "today", label: "今天", icon: Home },
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

function getExpenseSummary(expenses) {
  const totalCents = expenses.reduce((sum, item) => sum + item.amountCents, 0);
  const byCategory = expenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amountCents;
    return acc;
  }, {});
  return { totalCents, byCategory };
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
    activeReminders: data.reminders.filter((item) => item.active),
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

function MetricItem({ label, value, detail }) {
  return (
    <div className="metricItem">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
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

function TimelineList({ events, compact = false }) {
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

function ReminderList({ reminders, onToggle }) {
  return (
    <div className="reminderList">
      {reminders.map((reminder) => (
        <article className={`reminderItem ${reminder.active ? "" : "inactive"}`} key={reminder.id}>
          <div>
            <strong>{reminder.scheduledTime}</strong>
            <span>{REMINDER_KINDS[reminder.kind] || reminder.kind}</span>
          </div>
          <p>{reminder.title}</p>
          <button className="checkButton" type="button" onClick={() => onToggle(reminder)}>
            {reminder.active ? <Check size={16} /> : <Bell size={16} />}
          </button>
        </article>
      ))}
    </div>
  );
}

function TodayView({ data, derived, onOpenRecord, onGenerateInsight, aiLoading, onToggleReminder }) {
  const { pet, localCoach, insights } = data;
  const latestInsight = insights[0];
  const ageText = getAgeText(pet.birthday);

  return (
    <div className="workspaceGrid">
      <section className="heroPanel">
        <div className="petIdentity">
          <img src={pet.avatarUrl || "/photos/westie-portrait.svg"} alt={pet.name} />
          <div>
            <span>PetDaily</span>
            <h1>{pet.name}</h1>
            <p>{pet.breed} · {ageText} · 正在建立幼犬节奏</p>
          </div>
        </div>
        <button className="primaryButton" type="button" onClick={onOpenRecord}>
          <Plus size={18} />
          记录刚发生的事
        </button>
      </section>

      <section className="metricStrip" aria-label="今日概览">
        <MetricItem label="今日记录" value={`${derived.todayEvents.length} 条`} detail="饮食 / 如厕 / 观察" />
        <MetricItem
          label="最近体重"
          value={`${derived.latestWeight?.weightKg || pet.currentWeight || "-"} kg`}
          detail={derived.weightDelta !== null ? `${derived.weightDelta > 0 ? "+" : ""}${derived.weightDelta}kg` : "等待更多记录"}
        />
        <MetricItem label="待提醒" value={`${derived.activeReminders.length} 个`} detail="应用内计划" />
        <MetricItem label="累计花费" value={formatCurrency(derived.expenseSummary.totalCents)} detail="MVP 本地账本" />
      </section>

      <CoachPanel
        pet={pet}
        localCoach={localCoach}
        latestInsight={latestInsight}
        onGenerate={onGenerateInsight}
        loading={aiLoading}
      />

      <section className="contentPanel">
        <div className="sectionHeading">
          <p>今天的时间日记</p>
          <span>按发生时间倒序</span>
        </div>
        <TimelineList events={derived.todayEvents.length ? derived.todayEvents : derived.timelineEvents.slice(0, 6)} />
      </section>

      <aside className="sidePanel">
        <div className="sectionHeading">
          <p>下一步提醒</p>
          <span>第一版为应用内计划</span>
        </div>
        <ReminderList reminders={data.reminders.slice(0, 6)} onToggle={onToggleReminder} />
      </aside>
    </div>
  );
}

function RecordView({ events, onOpenRecord }) {
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
      <TimelineList events={events} />
    </section>
  );
}

function ExpenseForm({ petId, onCreate }) {
  const [category, setCategory] = useState("FOOD");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate({ petId, category, itemName, amount });
      setItemName("");
      setAmount("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inlineForm" onSubmit={submit}>
      <select value={category} onChange={(event) => setCategory(event.target.value)}>
        {Object.entries(EXPENSE_CATEGORIES).map(([key, value]) => (
          <option key={key} value={key}>{value}</option>
        ))}
      </select>
      <input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="物品名称" />
      <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="金额" inputMode="decimal" />
      <button className="secondaryButton" type="submit" disabled={saving}>
        <CircleDollarSign size={16} />
        {saving ? "保存中" : "记一笔"}
      </button>
    </form>
  );
}

function InsightsView({ data, derived, onCreateExpense }) {
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
      <section className="contentPanel">
        <div className="sectionHeading">
          <p>费用记录</p>
          <span>{formatCurrency(derived.expenseSummary.totalCents)} 累计</span>
        </div>
        <ExpenseForm petId={data.pet.id} onCreate={onCreateExpense} />
        <div className="expenseList">
          {data.expenses.map((expense) => (
            <article key={expense.id}>
              <div>
                <strong>{expense.itemName}</strong>
                <span>{EXPENSE_CATEGORIES[expense.category] || expense.category} · {formatDate(expense.purchasedAt)}</span>
              </div>
              <b>{formatCurrency(expense.amountCents)}</b>
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
  const [url, setUrl] = useState("/photos/westie-training.svg");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate({ petId, url, caption });
      setCaption("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inlineForm photoAddForm" onSubmit={submit}>
      <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="照片路径或 R2 URL" />
      <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="照片说明" />
      <button className="secondaryButton" type="submit" disabled={saving}>
        <ImagePlus size={16} />
        {saving ? "保存中" : "加入相册"}
      </button>
    </form>
  );
}

function PhotosView({ data, onCreatePhoto }) {
  return (
    <section className="singleColumn">
      <div className="pageHeader">
        <div>
          <h2>成长相册</h2>
          <p>第一版先保存照片路径和说明，Cloudflare 阶段会迁移到 R2 对象存储。</p>
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

function ProfileView({ data, onSaveProfile, onCreateReminder, onToggleReminder }) {
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
          <span>喂食、如厕、疫苗、驱虫</span>
        </div>
        <ReminderForm petId={data.pet.id} onCreate={onCreateReminder} />
        <ReminderList reminders={data.reminders} onToggle={onToggleReminder} />
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
    const { event } = await response.json();

    setData((current) => {
      const next = {
        ...current,
        timelineEvents: [event, ...current.timelineEvents]
      };
      if (payload.type === "WEIGHT" && payload.amount) {
        const weightRecord = {
          id: `local-${event.id}`,
          petId: payload.petId,
          measuredAt: event.happenedAt,
          weightKg: Number(payload.amount),
          note: payload.note,
          createdAt: event.createdAt
        };
        next.weightRecords = [...current.weightRecords, weightRecord];
        next.pet = { ...current.pet, currentWeight: Number(payload.amount) };
      }
      if (payload.type === "PHOTO" && payload.photoUrl) {
        next.photos = [
          {
            id: `local-photo-${event.id}`,
            petId: payload.petId,
            url: payload.photoUrl,
            caption: payload.title,
            takenAt: event.happenedAt,
            createdAt: event.createdAt
          },
          ...current.photos
        ];
      }
      return next;
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
    setData((current) => ({ ...current, expenses: [expense, ...current.expenses] }));
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
            onToggleReminder={toggleReminder}
          />
        ) : null}
        {activeTab === "record" ? (
          <RecordView events={derived.timelineEvents} onOpenRecord={() => setSheetOpen(true)} />
        ) : null}
        {activeTab === "insights" ? (
          <InsightsView data={data} derived={derived} onCreateExpense={createExpense} />
        ) : null}
        {activeTab === "photos" ? (
          <PhotosView data={data} onCreatePhoto={createPhoto} />
        ) : null}
        {activeTab === "profile" ? (
          <ProfileView
            data={data}
            onSaveProfile={saveProfile}
            onCreateReminder={createReminder}
            onToggleReminder={toggleReminder}
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
