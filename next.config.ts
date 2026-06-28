import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "astraflow.ucloud.cn" },
    ],
  },
}

export default nextConfig
