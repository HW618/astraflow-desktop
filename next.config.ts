import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "astraflow.ucloud.cn" }],
  },
}

export default nextConfig
