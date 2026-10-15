import process from 'node:process';
import { validateFrontendConfig, requireHttpsUrl } from '../shared/productionConfig.mjs';
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  validateFrontendConfig(env, command === 'build');
  if (command === 'build') {
    // The API is hosted separately on Render, never under the Vercel SPA.
    requireHttpsUrl(env.VITE_API_URL, 'VITE_API_URL');
  }
  return {
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
