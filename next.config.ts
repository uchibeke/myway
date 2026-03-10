import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [process.env.MYWAY_DEV_ORIGIN || 'localhost'].filter(Boolean),

  /**
   * Native addons that Next.js must NOT bundle — they use require() at runtime
   * and link against platform-specific .node binaries.
   *
   * better-sqlite3: synchronous SQLite driver (native .node binding)
   * sqlite-vec:     vector extension for sqlite (optional, degrades gracefully)
   */
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],

  experimental: {
    /**
     * Enable native View Transitions API support (Next.js 15.2+).
     * Wraps all client-side navigations in document.startViewTransition(),
     * so the EXIT animation starts immediately on click — no latency felt.
     * CSS rules below (::view-transition-old/new) control the visuals.
     */
    viewTransition: true,

  },
};

export default nextConfig;
