# PetDaily

PetDaily 是一个手机优先的智能宠物日常管理 MVP，当前围绕一只 3 个月西高地幼犬的养育闭环构建：档案、时间日记、体重曲线、喂食/排便/如厕/疫苗驱虫记录、提醒、照片成长墙、费用统计和 AI 养育教练。

## 快速开始

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

## AI 能力

未配置 `OPENAI_API_KEY` 时，应用会返回本地可解释的 mock 养育建议，保证 MVP 可离线演示。配置 key 后，服务端会使用结构化宠物档案、最近记录、体重、费用和提醒生成教练式建议。所有健康相关内容都提示不能替代兽医诊断。

## 文档

- [PRD](docs/PRD.md)
- [交互原型](docs/PROTOTYPE.md)
- [架构说明](docs/ARCHITECTURE.md)
- [使用说明](docs/USAGE.md)
- [迭代路线](docs/ROADMAP.md)
