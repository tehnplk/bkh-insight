import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  agentRules: false,
  // Bottom-left is taken by the sidebar's profile block.
  devIndicators: { position: "bottom-right" },
  // Dev only: let LAN machines that open http://<ip>:3000 load HMR/dev assets. Per machine via .env.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
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
