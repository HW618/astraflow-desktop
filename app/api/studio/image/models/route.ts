import { NextResponse } from "next/server"

import { buildImageModelOption } from "@/lib/image-openapi"
import { resolveModelverseProjectId } from "@/lib/modelverse-api-keys"
import {
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import {
  callUCloudAction,
  type UCloudCredentials,
  UCloudApiError,
} from "@/lib/ucloud"

export const runtime = "nodejs"

const LIST_PAGE_SIZE = 50

type SquareModel = {
  Id?: string
  Name?: string
  ChineseName?: string
  Manufacturer?: string
  CoverUrl?: string
  InputModalities?: string[] | null
  OutputModalities?: string[] | null
}

type ListResponse = {
  TotalCount?: number | string
  SquareModels?: SquareModel[] | Record<string, SquareModel>
}

function normalizeList(data: ListResponse["SquareModels"]): SquareModel[] {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function normalizeTotal(value: ListResponse["TotalCount"], fallback: number) {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function hasPublisherModelReference(model: SquareModel) {
  return [model.Id, model.Name].some((value) =>
    value?.toLowerCase().includes("publisher")
  )
}

async function fetchAllImageModels({
  credentials,
  projectId,
}: {
  credentials: UCloudCredentials
  projectId: string
}) {
  const fetchPage = (offset: number) =>
    callUCloudAction<ListResponse>({
      credentials,
      params: {
        Action: "ListUFSquareModel",
        ...(projectId ? { ProjectId: projectId } : {}),
        Offset: offset,
        Limit: LIST_PAGE_SIZE,
        OrderBy: "Name",
        Order: "Asc",
      },
    })

  const first = await fetchPage(0)
  const models = normalizeList(first.SquareModels)
  const total = normalizeTotal(first.TotalCount, models.length)

  for (let offset = LIST_PAGE_SIZE; offset < total; offset += LIST_PAGE_SIZE) {
    const page = await fetchPage(offset)
    models.push(...normalizeList(page.SquareModels))
  }

  return models.filter(
    (model) =>
      !hasPublisherModelReference(model) &&
      (model.OutputModalities ?? []).some(
        (modality) => modality.toLowerCase() === "image"
      )
  )
}

function toErrorResponse(error: unknown) {
  if (error instanceof UCloudApiError) {
    return NextResponse.json(
      { ok: false, message: error.message, retCode: error.retCode },
      { status: error.status }
    )
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to load image models." },
    { status: 500 }
  )
}

export async function GET() {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 403 }
    )
  }

  try {
    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        getSelectedUCloudProjectId() ||
        getStudioModelverseApiKey()?.projectId ||
        credentials.projectId,
    })

    const models = await fetchAllImageModels({ credentials, projectId })

    const options = models
      .filter((model) => model.Id)
      .map((model) =>
        buildImageModelOption({
          id: model.Id ?? "",
          name: model.Name ?? model.Id ?? "",
          label: model.ChineseName?.trim()
            ? `${model.Name ?? model.Id} · ${model.ChineseName}`
            : model.Name ?? model.Id ?? "",
          manufacturer: model.Manufacturer ?? "",
          inputModalities: model.InputModalities ?? [],
          outputModalities: model.OutputModalities ?? [],
          coverUrl: model.CoverUrl ?? null,
        })
      )

    const supported = options.filter((option) => option.supported)
    const disabled = options.filter((option) => !option.supported)

    return NextResponse.json({
      ok: true,
      data: {
        supported,
        disabled,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
