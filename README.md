# AI 智能客服（aitalk）

基于 **Nuxt 全栈** 的智能客服演示项目：手机聊天气泡 UI、SSE 流式回复、DeepSeek Function Calling（天气 API + 本地 FAQ）、PostgreSQL 会话记忆与历史管理。

仓库：[https://github.com/myFsx/aitalk](https://github.com/myFsx/aitalk)

## 演示视频

<video src="./docs/demo.mp4" controls width="360"></video>

若上方无法播放，可直接下载：[docs/demo.mp4](./docs/demo.mp4)

---

## 功能亮点

- **流式对话**：服务端 SSE 推送 token，前端打字机效果展示
- **Function Calling**：模型自动选择并调用
  - `get_weather` → Open-Meteo 实时天气（无需额外 Key）
  - `search_faq` → 本地 FAQ 知识库关键词检索
- **多轮上下文**：Prisma + PostgreSQL 持久化 Session / Message
- **历史管理**：查看、继续会话、重命名、删除、清空全部
- **安全**：`AI_API_KEY` 仅存服务端环境变量，不暴露给浏览器

---

## 技术栈


| 层级   | 技术                                |
| ---- | --------------------------------- |
| 前端   | Vue 3、Nuxt、手机聊天气泡 UI              |
| 后端   | Nuxt Server / Nitro API           |
| AI   | DeepSeek Chat API（tools + stream） |
| 数据   | Prisma、PostgreSQL（Neon 等）         |
| 外部能力 | Open-Meteo 天气、本地 `faq.json`       |


---



## 核心链路

```
用户发消息
  → POST /api/chat（存库 + 拉历史）
  → ① 非流式调用 DeepSeek（携带 tools）
  → ② 若返回 tool_calls：后端执行天气 / FAQ
  → ③ 再流式生成最终回答（SSE：session / tools / token / done）
  → 前端按事件更新气泡
```

相关代码：

- 对话入口：`server/api/chat.post.ts`
- 工具定义与执行：`server/utils/tools.ts`
- 系统提示词：`server/utils/assistant-system.ts`
- FAQ 数据：`server/data/faq.json`
- 页面 UI：`app/pages/ai.vue`

---



## 本地运行



### 1. 安装依赖

```bash
npm install
```



### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
AI_API_KEY="your-deepseek-api-key"
AI_BASE_URL="https://api.deepseek.com"
```



### 3. 同步数据库表

```bash
npx prisma db push
```



### 4. 启动

```bash
npm run dev
```

浏览器打开：[http://127.0.0.1:3000/ai](http://127.0.0.1:3000/ai)

可试：

- 「北京今天天气怎么样？」
- 「七天无理由怎么退货？」

---



## 生产构建

```bash
npm run build
npm run start
```

部署时需配置与本地相同的环境变量：`DATABASE_URL`、`AI_API_KEY`、`AI_BASE_URL`。

---



## 项目结构（简）

```
app/pages/ai.vue          # 手机聊天界面
server/api/chat.post.ts   # 对话 + 工具调用 + SSE
server/api/sessions/      # 历史会话 CRUD
server/utils/tools.ts     # get_weather / search_faq
server/data/faq.json      # 本地 FAQ 知识库
prisma/schema.prisma      # Session / Message 模型
```

---

