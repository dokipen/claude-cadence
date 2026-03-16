import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.VITE_API_PORT || "4000";
const agentHubPort = Number(process.env.VITE_AGENT_HUB_PORT ?? "4200");
if (!Number.isInteger(agentHubPort) || agentHubPort < 1 || agentHubPort > 65535) {
  throw new Error("VITE_AGENT_HUB_PORT must be a valid port number");
}

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
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
