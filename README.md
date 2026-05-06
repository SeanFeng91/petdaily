# PetDaily

PetDaily 是一个手机优先的智能宠物日常管理 MVP，当前围绕一只 3 个月西高地幼犬的养育闭环构建：档案、时间日记、体重曲线、喂食/排便/如厕/疫苗驱虫记录、提醒、照片成长墙、费用统计和 AI 养育教练。

## 快速开始

本地开发默认使用 SQLite，适合快速调试：

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

打开 `http://127.0.0.1:3000`。

## 常用命令

- `npm run dev`：启动本地开发环境。
- `npm run build`：生产构建验证。
- `npm run lint`：代码静态检查。
- `npm run db:push`：将 Prisma schema 写入 SQLite。
- `npm run db:seed`：写入默认西高地幼犬样例数据。
- `npm run db:reset`：重置并重新写入样例数据。
- `npm run cf:d1:create`：创建 Cloudflare D1 数据库。
- `npm run cf:d1:migrate`：将 `migrations/` 迁移应用到远程 D1。
- `npm run cf:d1:seed`：将 `cloudflare/seed.sql` 写入远程 D1。
- `npm run cf:deploy`：构建并部署到 Cloudflare Workers。

## 手机端使用

- 删除模拟记录：进入「记录」，每条时间日记右侧都有「删除」按钮。删除照片类型记录时，会同步移除相册中对应照片。
- 手机拍照/相册：进入「相册」，点击「手机拍摄」可调用相机，点击「读取相册」可选择已有照片。照片会先在浏览器端压缩，再同步到 Cloudflare D1。
- 提醒事项：进入「我的」新增提醒；每条提醒可点勾号完成今天、暂停/启用，或直接删除。首页会按时间显示“已到点 / 稍后 / 今日已完成 / 已暂停”。

## Cloudflare D1 上线

Cloudflare/Wrangler 命令建议使用 Node 22+。本项目提供 `.nvmrc`，如果你使用 nvm：

```bash
nvm use
```

1. 登录 Cloudflare：

```bash
npx wrangler login
npx wrangler whoami
```

2. 创建 D1 数据库：

```bash
npm run cf:d1:create
```

3. 将命令输出中的 `database_id` 填到 `wrangler.jsonc` 的 `database_id` 字段，替换 `REPLACE_WITH_D1_DATABASE_ID`。

4. 初始化远程 D1：

```bash
npm run cf:d1:migrate
npm run cf:d1:seed
```

5. 部署：

```bash
npm run cf:deploy
```

部署后手机端直接打开 Cloudflare 返回的 URL，就会读写远程 D1。线上运行时使用 `DB` 这个 D1 binding；本地普通 `npm run dev` 仍然使用 SQLite。

## AI 能力

未配置 `OPENAI_API_KEY` 时，应用会返回本地可解释的 mock 养育建议，保证 MVP 可离线演示。配置 key 后，服务端会使用结构化宠物档案、最近记录、体重、费用和提醒生成教练式建议。所有健康相关内容都提示不能替代兽医诊断。

## 文档

- [PRD](docs/PRD.md)
- [交互原型](docs/PROTOTYPE.md)
- [架构说明](docs/ARCHITECTURE.md)
- [使用说明](docs/USAGE.md)
- [迭代路线](docs/ROADMAP.md)
