import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  agentRules: false,
  experimental: {
    // proxy.ts buffers request bodies and silently truncates past this (default 10MB). REP .xls uploads
    // (/api/fund/rep-import, one file per request) go up to 30MB plus multipart overhead.
    proxyClientMaxBodySize: "32mb",
  },
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
