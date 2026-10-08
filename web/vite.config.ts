import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages 會放在 /<repo>/ 底下，用相對路徑最省事
  base: "./",
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
