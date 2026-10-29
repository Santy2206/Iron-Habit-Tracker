import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: the whole app is a self-contained SPA bundle.
  // All server logic lives in Supabase Edge Functions, so this output
  // can be wrapped by Tauri (desktop) / Capacitor (mobile) or hosted
  // on any static host.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
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
