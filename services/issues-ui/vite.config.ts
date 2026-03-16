import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.VITE_API_PORT || "4000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/graphql": `http://localhost:${apiPort}`,
    },
  },
});
