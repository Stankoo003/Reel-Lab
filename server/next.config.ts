import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The API is consumed by a native app, not a browser, so no CORS layer is needed.
  // Node runtime everywhere: bcrypt, postgres.js and the S3 SDK are not edge-compatible.
  turbopack: { root: path.resolve(__dirname) },
  serverExternalPackages: ["postgres", "bcryptjs", "nodemailer"],
  async headers() {
    return [
      {
        source: "/media/:path*",
        headers: [{ key: "Cache-Control", value: "max-age=2592000, public" }],
      },
    ];
  },
};

export default nextConfig;
