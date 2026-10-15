import { resolveApiBaseUrl } from '../shared/apiUrl.mjs';
import process from 'node:process';
import { validateFrontendConfig } from '../shared/productionConfig.mjs';
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  validateFrontendConfig(env, command === 'build');
  const apiUrl = resolveApiBaseUrl(env.VITE_API_URL, { production: command === 'build' });
  return {
  // Embed the same normalized mount prefix that the runtime API client uses.
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) },
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules\/three\//, maxSize: 240000 },
            { name: 'supabase', test: /node_modules\/@supabase\// },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  };
});
