import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for a lean Docker image — see apps/web/Dockerfile.
  output: "standalone",
};

export default nextConfig;
