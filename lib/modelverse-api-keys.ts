import { callUCloudAction, type UCloudCredentials } from "@/lib/ucloud"

export type ModelverseApiKeyOption = {
  id: string
  name: string
}

export type ModelverseApiKey = ModelverseApiKeyOption & {
  key?: string
}

export type UCloudProjectOption = {
  id: string
  name: string
  memberCount: number | null
  resourceCount: number | null
  createdAt: number | null
  isDefault: boolean | null
}

type UMInferAPIKey = {
  KeyId?: string
  Name?: string
  Key?: string
  Status?: number
  ModelverseDisabled?: number
}

type ListUMInferAPIKeyResponse = {
  Action?: string
  RetCode?: number
  Message?: string
  Data?: UMInferAPIKey[] | Record<string, UMInferAPIKey>
  TotalCount?: number
}

type UCloudProject = {
  ProjectId?: string
  ProjectName?: string
  ParentId?: string
  ParentName?: string
  CreateTime?: number
  IsDefault?: boolean
  MemberCount?: number
  ResourceCount?: number
}

type GetProjectListResponse = {
  ProjectCount?: number
  ProjectSet?: UCloudProject[] | Record<string, UCloudProject>
}

function normalizeApiKeys(data: ListUMInferAPIKeyResponse["Data"]) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function normalizeProjects(
  data: GetProjectListResponse["ProjectSet"]
) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function getProjectId(project: UCloudProject) {
  return project.ProjectId?.trim() || ""
}

export async function listUCloudProjects({
  credentials,
}: {
  credentials: UCloudCredentials
}): Promise<UCloudProjectOption[]> {
  const response = await callUCloudAction<GetProjectListResponse>({
    credentials,
    params: {
      Action: "GetProjectList",
    },
  })
  const projects = normalizeProjects(response.ProjectSet)

  return projects
    .map((project) => {
      const id = getProjectId(project)

      return {
        id,
        name: project.ProjectName || id || "Unnamed project",
        memberCount:
          typeof project.MemberCount === "number" ? project.MemberCount : null,
        resourceCount:
          typeof project.ResourceCount === "number"
            ? project.ResourceCount
            : null,
        createdAt:
          typeof project.CreateTime === "number" ? project.CreateTime : null,
        isDefault:
          typeof project.IsDefault === "boolean" ? project.IsDefault : null,
      }
    })
    .filter((project) => project.id)
}

export function getDefaultUCloudProject(projects: UCloudProjectOption[]) {
  return (
    projects.find((project) => project.isDefault === true) ??
    projects.find((project) => project.id.trim()) ??
    null
  )
}

export async function resolveModelverseProjectId({
  credentials,
  preferredProjectId,
}: {
  credentials: UCloudCredentials
  preferredProjectId?: string
}) {
  const projects = await listUCloudProjects({ credentials })
  const normalizedPreferredProjectId = preferredProjectId?.trim()

  if (
    normalizedPreferredProjectId &&
    projects.some((project) => project.id === normalizedPreferredProjectId)
  ) {
    return normalizedPreferredProjectId
  }

  const project = getDefaultUCloudProject(projects)

  if (!project?.id) {
    throw new Error("No UCloud project is available for Modelverse API keys.")
  }

  return project.id
}

export async function listModelverseApiKeys({
  credentials,
  projectId,
}: {
  credentials: UCloudCredentials
  projectId: string
}): Promise<ModelverseApiKey[]> {
  const response = await callUCloudAction<ListUMInferAPIKeyResponse>({
    credentials,
    params: {
      Action: "ListUMInferAPIKey",
      ProjectId: projectId,
      Offset: 0,
      Limit: 100,
    },
  })

  return normalizeApiKeys(response.Data)
    .filter(
      (apiKey) =>
        apiKey.KeyId &&
        (apiKey.Status === undefined || apiKey.Status === 1) &&
        apiKey.ModelverseDisabled !== 1
    )
    .map((apiKey) => ({
      id: apiKey.KeyId as string,
      name: apiKey.Name || apiKey.KeyId || "Unnamed key",
      key: apiKey.Key,
    }))
}

export async function findModelverseApiKey({
  credentials,
  projectId,
  apiKeyId,
}: {
  credentials: UCloudCredentials
  projectId: string
  apiKeyId: string
}) {
  const apiKeys = await listModelverseApiKeys({
    credentials,
    projectId,
  })

  return apiKeys.find((apiKey) => apiKey.id === apiKeyId)
}
