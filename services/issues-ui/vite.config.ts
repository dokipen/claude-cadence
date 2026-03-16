import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.VITE_API_PORT || "4000";
const agentHubPort = Number(process.env.VITE_AGENT_HUB_PORT ?? "4200");
if (!Number.isInteger(agentHubPort) || agentHubPort < 1 || agentHubPort > 65535) {
  throw new Error("VITE_AGENT_HUB_PORT must be a valid port number");
}
const agentHubToken = process.env.VITE_AGENT_HUB_TOKEN || "";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
  server: {
    proxy: {
      "/graphql": `http://localhost:${apiPort}`,
      "/api/v1": {
        target: `http://localhost:${agentHubPort}`,
        configure: (proxy) => {
          if (agentHubToken) {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${agentHubToken}`);
            });
          }
        },
      },
      "/ws/terminal": {
        target: `http://localhost:${agentHubPort}`,
        ws: true,
        configure: (proxy) => {
          if (agentHubToken) {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${agentHubToken}`);
            });
          }
        },
      },
    },
  },
});
