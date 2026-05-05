"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { EXPENSE_CATEGORIES, formatDate } from "@/lib/domain";

const categoryColors = {
  FOOD: "#2f8f6b",
  MEDICAL: "#de5d83",
  DAILY: "#4876d3",
  TOY: "#d98b38",
  GROOMING: "#7c5bc7"
};

export function WeightChart({ weightRecords }) {
  const data = weightRecords.map((item) => ({
    date: formatDate(item.measuredAt),
    weight: item.weightKg
  }));

  return (
    <div className="chartBox">
      <div className="sectionHeading">
        <p>体重曲线</p>
        <span>早餐前固定称重</span>
      </div>
      <div className="chartFrame">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
            <defs>
              <linearGradient id="weightFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2f8f6b" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#2f8f6b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#dce6e1" strokeDasharray="4 4" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={34} domain={["dataMin - 0.1", "dataMax + 0.1"]} />
            <Tooltip formatter={(value) => [`${value} kg`, "体重"]} labelFormatter={(label) => `${label}`} />
            <Area type="monotone" dataKey="weight" stroke="#2f8f6b" strokeWidth={3} fill="url(#weightFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ExpenseChart({ expenses }) {
  const grouped = expenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amountCents / 100;
    return acc;
  }, {});

  const data = Object.entries(grouped).map(([category, amount]) => ({
    category,
    name: EXPENSE_CATEGORIES[category] || category,
    amount
  }));

  return (
    <div className="chartBox">
      <div className="sectionHeading">
        <p>费用结构</p>
        <span>本地账本统计</span>
      </div>
      <div className="chartFrame">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#dce6e1" strokeDasharray="4 4" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={34} />
            <Tooltip formatter={(value) => [`¥${Number(value).toFixed(0)}`, "费用"]} />
            <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.category} fill={categoryColors[entry.category] || "#6b7280"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
