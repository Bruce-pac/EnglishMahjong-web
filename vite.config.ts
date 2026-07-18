import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 后端跑在 8000，前端代理过去，省掉跨域的麻烦
    proxy: { "/api": "http://localhost:8000" },
  },
});
