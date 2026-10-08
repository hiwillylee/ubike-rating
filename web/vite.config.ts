import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages 會放在 /<repo>/ 底下，用相對路徑最省事
  base: "./",
  plugins: [react()],
  resolve: {
    // 只用 CPU (wasm) 版 ONNX Runtime，避免把 WebGPU 版本（數十 MB）打包進來
    alias: [{ find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" }],
  },
  server: { fs: { allow: [".."] } },
});
