import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiHost = process.env.VITE_API_HOST || "localhost";
const apiPort = process.env.VITE_API_PORT || "4000";
const agentHubHost = process.env.VITE_AGENT_HUB_HOST || "localhost";
const agentHubPort = Number(process.env.VITE_AGENT_HUB_PORT ?? "4200");
if (!Number.isInteger(agentHubPort) || agentHubPort < 1 || agentHubPort > 65535) {
  throw new Error("VITE_AGENT_HUB_PORT must be a valid port number");
}
const agentHubToken = process.env.HUB_API_TOKEN || process.env.AGENT_HUB_TOKEN || "";

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.BUILD_SHA ?? 'dev'),
  },
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
  server: {
    proxy: {
      "/graphql": `http://${apiHost}:${apiPort}`,
      "/api/v1": {
        target: `http://${agentHubHost}:${agentHubPort}`,
        configure: (proxy) => {
          if (agentHubToken) {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${agentHubToken}`);
            });
          }
        },
      },
      "/ws/terminal": {
        target: `http://${agentHubHost}:${agentHubPort}`,
        ws: true,
        configure: (proxy) => {
          if (agentHubToken) {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${agentHubToken}`);
            });
            proxy.on("proxyReqWs", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${agentHubToken}`);
            });
          }
        },
      },
    },
  },
});
