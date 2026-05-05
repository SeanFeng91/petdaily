# PetDaily 架构说明

## 1. 技术栈

- Next.js App Router：页面、API Routes 和服务端数据读取。
- React Client Components：移动端工作台、表单、弹层、图表交互。
- Prisma + SQLite：本地 MVP 数据库。
- Recharts：体重曲线和费用图表。
- lucide-react：按钮和导航图标。

## 2. 目录结构

```text
app/
  api/                 API 路由
  globals.css          全局视觉系统
  layout.jsx
  page.jsx             服务端读取仪表盘数据
components/
  petdaily-app.jsx     主交互工作台
  quick-record-sheet.jsx
  charts-panel.jsx
lib/
  ai-coach.js          AI / mock fallback
  domain.js            业务字典和格式化工具
  prisma.js            Prisma client
  server-data.js       首页聚合数据
prisma/
  schema.prisma
  seed.js
public/photos/         demo 照片占位资源
docs/
```

## 3. 数据模型

- `PetProfile`：宠物基础档案。
- `TimelineEvent`：统一时间日记。
- `Reminder`：应用内提醒计划。
- `WeightRecord`：体重曲线数据。
- `Expense`：采购费用。
- `PhotoAsset`：照片路径/URL 和说明。
- `AiInsight`：AI 建议历史。

## 4. API

- `GET/POST /api/pets`
- `GET/POST /api/timeline`
- `GET/POST/PATCH /api/reminders`
- `GET/POST /api/expenses`
- `GET/POST /api/photos`
- `GET /api/insights`
- `POST /api/ai/coach`

## 5. AI 设计

`POST /api/ai/coach` 会聚合宠物档案、最近时间线、体重、提醒和费用。

- 未配置 `OPENAI_API_KEY`：返回本地规则建议，保证演示闭环。
- 已配置 `OPENAI_API_KEY`：服务端调用在线模型，前端不接触密钥。
- 异常或网络失败：自动回退本地规则建议。

## 6. Cloudflare 迁移预留

- SQLite 表结构以 D1 易迁移的关系模型组织。
- 图片第一版只保存路径/URL；后续可将文件上传到 R2，再保存 R2 URL。
- API 路由保持资源化，后续可迁移到 Workers 或保留 Next 服务端适配层。
- 前端可部署到 Cloudflare Pages，结构化数据和对象存储分离。
