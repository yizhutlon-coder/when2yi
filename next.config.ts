import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean, self-contained server bundle for the Docker image.
  output: "standalone",
  // Native module — keep it external so Next doesn't try to bundle the .node binary.
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Organizer/edit tokens live in the URL, so never leak the full URL (with
          // token) to other sites via the Referer header — send only the origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
