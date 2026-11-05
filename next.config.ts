import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  agentRules: false,
  // Bottom-left is taken by the sidebar's profile block.
  devIndicators: { position: "bottom-right" },
  // Hostnames (comma-separated, no scheme/port) other LAN machines use to open the dev server.
  // Per machine, so it lives in .env rather than here.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").map((h) => h.trim()).filter(Boolean),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
