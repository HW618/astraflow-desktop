import { networkInterfaces } from "node:os"
import type { NextConfig } from "next"

function parseAllowedDevOrigins(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []
  )
}

function getLocalNetworkHosts() {
  const hosts: string[] = []

  for (const networkInterfaceList of Object.values(networkInterfaces())) {
    for (const networkInterface of networkInterfaceList ?? []) {
      if (networkInterface.family === "IPv4" && !networkInterface.internal) {
        hosts.push(networkInterface.address)
      }
    }
  }

  return hosts
}

function getAllowedDevOrigins() {
  const origins = [
    ...parseAllowedDevOrigins(process.env.ASTRAFLOW_ALLOWED_DEV_ORIGINS),
    ...getLocalNetworkHosts(),
  ]

  return origins.length > 0 ? Array.from(new Set(origins)) : undefined
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  output: process.env.ASTRAFLOW_ELECTRON === "1" ? "standalone" : undefined,
  serverExternalPackages: ["better-sqlite3"],
  images: {
    unoptimized: process.env.ASTRAFLOW_ELECTRON === "1",
    remotePatterns: [{ protocol: "https", hostname: "astraflow.ucloud.cn" }],
  },
}

export default nextConfig
