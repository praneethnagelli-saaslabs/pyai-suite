import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 3000),
    proxy: {
      "/api": "http://localhost:4000",
      "/v1": "http://localhost:4000",
      "/health": "http://localhost:4000",
      "/openapi.json": "http://localhost:4000",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
