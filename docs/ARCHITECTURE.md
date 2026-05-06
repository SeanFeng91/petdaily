# PetDaily 架构说明

## 1. 技术栈

- Next.js App Router：页面、API Routes 和服务端数据读取。
- React Client Components：移动端工作台、表单、弹层、图表交互。
- Prisma + SQLite：本地开发数据库。
- Cloudflare Workers + D1：手机端线上使用的远程数据库运行时。
- OpenNext for Cloudflare：将 Next.js 应用构建为 Cloudflare Worker。
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
  cloudflare.js        Cloudflare runtime binding 读取
  domain.js            业务字典和格式化工具
  pet-store.js         D1 / SQLite 双运行时数据访问层
  prisma.js            Prisma client
  server-data.js       首页聚合数据
migrations/            Cloudflare D1 schema migration
prisma/
  schema.prisma
  seed.js
cloudflare/
  seed.sql             远程 D1 demo seed
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
- `GET/POST/DELETE /api/timeline`
- `GET/POST/PATCH/DELETE /api/reminders`
- `GET/POST /api/expenses`
- `GET/POST/DELETE /api/photos`
- `GET /api/insights`
- `POST /api/ai/coach`

## 5. AI 设计

`POST /api/ai/coach` 会聚合宠物档案、最近时间线、体重、提醒和费用。

- 未配置 `OPENAI_API_KEY`：返回本地规则建议，保证演示闭环。
- 已配置 `OPENAI_API_KEY`：服务端调用在线模型，前端不接触密钥。
- 异常或网络失败：自动回退本地规则建议。

## 6. Cloudflare D1 运行方式

- 本地 `npm run dev` 默认使用 Prisma + SQLite，数据库文件为 `data/petdaily.db`。
- Cloudflare 部署后由 OpenNext Worker 运行 Next.js，代码通过 `DB` binding 访问 D1。
- `lib/pet-store.js` 是唯一数据访问层；API 和首页不直接依赖 Prisma。
- D1 schema 位于 `migrations/0001_petdaily_schema.sql`，远程 seed 位于 `cloudflare/seed.sql`。
- 图片当前在浏览器端压缩为 Data URL 后写入 D1，适合少量个人记录；下一步可以把上传文件接入 R2，再保存 R2 URL。
