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

- 首页是「白板日记」：打开后先看到小型快捷事件和连续时间轴，不再把头像、统计卡或大号新增按钮放在首屏。
- 快捷事件：首页可一键记录早餐、晚餐、如厕、排便、称重、训练等常用事件；桌面键盘支持数字键 `1-9` 触发。进入「我的」可以配置快捷按钮名称、类型、默认数值和备注。
- 新增记录支持图片：点击悬浮 `+` 后可以拍照、读取相册或粘贴图片 URL；带图片的事件直接沉淀在时间轴里，点缩略图可全屏浏览。
- 体重/费用维护：进入「洞察」，已有体重和费用都可以修改或删除。
- 删除模拟记录：在首页时间轴里直接删除记录。删除带照片的记录时，会同步移除关联照片资产。
- 提醒事项：进入「我的」新增提醒；每条提醒可点勾号完成今天、暂停/启用，或直接删除。首页只显示紧凑的今日提醒摘要。
- iPhone 沉浸式使用：用 Safari 打开部署地址，分享按钮选择「添加到主屏幕」。本项目已提供 `manifest.webmanifest`、主题色和 Apple Web App 元信息，从桌面图标进入时会尽量以独立 Web App 形式打开。
- 微信内使用建议：普通网页仍会保留微信浏览器顶部容器；如果后续要彻底沉浸式和订阅消息，建议单独做微信小程序壳，并配置正式业务域名，不建议把 `workers.dev` 当最终微信入口域名。
- 狗叫声检测：进入「监听」页后可在手机不锁屏、应用前台运行时分析环境音；疑似狗叫会保存为候选短音频、自动写入时间线，并进入声音库按 embedding 聚类。主人可以给一组相似声音批量标注，当前不保存全天录音；锁屏后台长期监听需要原生 App 或固定采集设备。

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

狗叫音频片段线上使用 `BARK_AUDIO` 这个 R2 binding，默认 bucket 名称为 `petdaily-bark-audio`。若 bucket 尚未创建，先运行 `wrangler r2 bucket create petdaily-bark-audio`，再部署。

狗叫监听会把连续触发合并为 `BarkSession` 叫声段，并把短片段音频保存到 R2、声学特征和聚类索引保存到 D1。上线前请确保已应用 `migrations/0005_bark_sessions.sql` 和 `migrations/0006_bark_model_artifacts.sql`。

如果部署时报 `assets-upload-session` / `code: 10013`，先刷新本机 Wrangler OAuth 权限：

```bash
nvm use
npx wrangler login
npx wrangler whoami
npm run cf:deploy
```

`whoami` 不应再提示缺少 `artifacts:write`；否则静态资产上传会话可能继续失败。

## 狗叫模型训练数据同步

远程 D1/R2 中的声音数据可以下载到本地训练目录：

```bash
nvm use
npm run bark:model:download
```

下载结果会写入 `data/bark-sync/`，其中 `samples.json`、`sessions.json`、`clusters.json` 是训练元数据，音频片段会进入 `data/bark-sync/audio/`，下载状态在 `audio-manifest.json`。

训练并推回远程 D1：

```bash
npm run bark:model:train
npm run bark:model:push
```

一键完成下载、训练、推送：

```bash
npm run bark:model:sync
```

## AI 能力

未配置 `OPENAI_API_KEY` 时，应用会返回本地可解释的 mock 养育建议，保证 MVP 可离线演示。配置 key 后，服务端会使用结构化宠物档案、最近记录、体重、费用和提醒生成教练式建议。所有健康相关内容都提示不能替代兽医诊断。

## 文档

- [PRD](docs/PRD.md)
- [交互原型](docs/PROTOTYPE.md)
- [架构说明](docs/ARCHITECTURE.md)
- [使用说明](docs/USAGE.md)
- [迭代路线](docs/ROADMAP.md)
