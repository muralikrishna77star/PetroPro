import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for a lean Docker image — see apps/web/Dockerfile.
  output: "standalone",
  // The browser reaches the API's session routes through this site's own origin, so the refresh
  // cookie is first-party: browsers block third-party cookies, and the API is on another domain.
  // API_INTERNAL_URL is only for when this server reaches the API differently from a browser.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    return [{ source: "/session-api/:path*", destination: `${api}/auth/:path*` }];
  },
};

export default nextConfig;
