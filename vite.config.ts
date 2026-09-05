/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 后端跑在 8000，前端代理过去，省掉跨域的麻烦
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    // 单元测试只跑 src 下的 *.test.ts(x)。playthrough.mjs 是 playwright 的
    // 端到端脚本，不归 vitest 管，别把它扫进来。
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
