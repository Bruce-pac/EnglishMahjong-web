# 英语麻将 · 前端

「英语麻将」的网页前端——学生用字母牌拼英语单词的教学游戏，规则以「多组词、组长词」为最高优先级。

这个仓库只包含前端（React + Vite + TypeScript）。**前端不含任何规则逻辑、不含词典**，只做三件事：渲染服务端下发的牌局状态、回放服务端返回的事件（动画）、把玩家操作 POST 回去。规则、词库、计分全部在后端，后端暂未开源。

## 本地开发

需要一个跑在 `localhost:8000` 的后端（dev server 已配好 `/api` 代理）：

```bash
npm install
npm run dev        # Vite dev server，5173 端口
npm run build      # 含 tsc 类型检查
```

`playthrough.mjs` 是浏览器端到端测试（Playwright），需要前后端都在跑：

```bash
node playthrough.mjs
```

## 协议

[MIT](LICENSE)
