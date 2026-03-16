import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.VITE_API_PORT || "4000";
const agentHubPort = process.env.VITE_AGENT_HUB_PORT || "4200";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/graphql": `http://localhost:${apiPort}`,
      "/api/v1": `http://localhost:${agentHubPort}`,
      "/ws/terminal": {
        target: `http://localhost:${agentHubPort}`,
        ws: true,
      },
    },
  },
});
