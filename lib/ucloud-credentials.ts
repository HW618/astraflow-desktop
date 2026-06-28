import type { UCloudCredentials } from "@/lib/ucloud"

/**
 * UCloud credentials are baked into the environment, not provided by the user.
 * Set these in `.env` (or `.env.local`):
 *   UCLOUD_PUBLIC_KEY   — UCloud API public key (PublicKey / AccessKey)
 *   UCLOUD_PRIVATE_KEY  — UCloud API private key (PrivateKey / SecretKey)
 *   UCLOUD_PROJECT_ID   — Default project id used for model-square requests
 */
export function getUCloudCredentials(): UCloudCredentials | null {
  const accessKey = process.env.UCLOUD_PUBLIC_KEY?.trim()
  const secretKey = process.env.UCLOUD_PRIVATE_KEY?.trim()
  const projectId = process.env.UCLOUD_PROJECT_ID?.trim() ?? ""

  if (!accessKey || !secretKey) {
    return null
  }

  return { accessKey, secretKey, projectId }
}

export function getDefaultProjectId() {
  return process.env.UCLOUD_PROJECT_ID?.trim() ?? ""
}
