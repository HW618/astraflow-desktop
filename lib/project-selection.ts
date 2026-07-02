export const UCLOUD_PROJECT_CHANGED_EVENT = "astraflow:ucloud-project-changed"
export const UCLOUD_PROJECT_STORAGE_KEY = "astraflow:ucloud-project-id"

export type UCloudProjectChangedDetail = {
  projectId: string
}

export function readSelectedUCloudProjectId() {
  if (typeof window === "undefined") {
    return ""
  }

  return window.localStorage.getItem(UCLOUD_PROJECT_STORAGE_KEY)?.trim() ?? ""
}

export function writeSelectedUCloudProjectId(projectId: string) {
  if (typeof window === "undefined") {
    return
  }

  const normalizedProjectId = projectId.trim()

  if (normalizedProjectId) {
    window.localStorage.setItem(
      UCLOUD_PROJECT_STORAGE_KEY,
      normalizedProjectId
    )
  } else {
    window.localStorage.removeItem(UCLOUD_PROJECT_STORAGE_KEY)
  }
}
