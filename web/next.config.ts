import type { NextConfig } from "next";

/**
 * The FastAPI backend authenticates with a SameSite=Lax, HttpOnly session
 * cookie plus an X-CSRF-Token header. Proxying `/api/*` through Next.js keeps
 * every browser call same-origin, so that cookie model works unchanged in
 * development (Next on :3000, uvicorn on :8000) and in production alike.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for the container image (web/Dockerfile).
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
