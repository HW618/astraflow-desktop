"use client"

import * as React from "react"
import {
  RiAddLine,
  RiCloseLine,
  RiDownloadLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiQuestionLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { VideoPlayer } from "@/components/ui/video-player"
import {
  fetchStudioModelsWithCache,
  getPreferredStudioModelId,
  saveSelectedStudioModel,
} from "@/lib/studio-model-cache"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn, createClientId } from "@/lib/utils"
import type { StudioSession } from "@/lib/studio-types"
import type {
  StudioVideoGeneration,
  StudioVideoModelOption,
  StudioVideoOutput,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"

type StudioVideoWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; error?: unknown; message?: string }
type ApiResponse<T> = ApiOk<T> | ApiErr

const MAX_REFERENCE_IMAGES = 8
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024
const VIDEO_FALLBACK_TITLE = "New video"

function getVideoCopy(locale: string) {
  if (locale === "zh") {
    return {
      model: "模型",
      modelPlaceholder: "选择模型",
      modelsLoading: "正在加载模型...",
      modelsFailed: "加载视频模型失败。",
      prompt: "提示词",
      promptPlaceholder: "描述要生成的视频",
      references: "参考图",
      referenceUrl: "图像链接",
      addUrl: "添加链接",
      attach: "添加图片",
      advanced: "高级选项",
      advancedHide: "收起高级选项",
      generate: "生成",
      submitFailed: "生成失败。",
      empty: "暂无视频",
      download: "下载",
      save: "保存",
      saved: "已保存",
      queued: "排队中",
      running: "生成中",
      generatingTitle: "正在生成视频",
      generatingHint: "完成后会自动保存到文件库",
      complete: "已完成",
      failed: "失败",
      errorTitle: "视频生成失败",
      errorFallback: "Provider 没有返回错误详情。",
      mediaFailed: "视频加载失败",
    }
  }

  return {
    model: "Model",
    modelPlaceholder: "Select a model",
    modelsLoading: "Loading models...",
    modelsFailed: "Failed to load video models.",
    prompt: "Prompt",
    promptPlaceholder: "Describe the video",
    references: "References",
    referenceUrl: "Image URL",
    addUrl: "Add URL",
    attach: "Add image",
    advanced: "Advanced",
    advancedHide: "Hide advanced",
    generate: "Generate",
    submitFailed: "Failed to generate.",
    empty: "No videos",
    download: "Download",
    save: "Save",
    saved: "Saved",
    queued: "Queued",
    running: "Running",
    generatingTitle: "Generating video",
    generatingHint: "It will be saved to Files when ready",
    complete: "Complete",
    failed: "Failed",
    errorTitle: "Video generation failed",
    errorFallback: "The provider did not return error details.",
    mediaFailed: "Failed to load video",
  }
}

function isOk<T>(payload: ApiResponse<T>): payload is ApiOk<T> {
  return payload.ok === true
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>

  if (!response.ok || !isOk(payload)) {
    const message =
      (!isOk(payload) &&
        (payload.message ||
          (typeof payload.error === "string" ? payload.error : ""))) ||
      `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload.data
}

async function fetchVideoModels() {
  const response = await fetch("/api/studio/video/models")
  return readJson<{
    supported: StudioVideoModelOption[]
    disabled: StudioVideoModelOption[]
  }>(response)
}

async function fetchVideoGenerations(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/video-generations`
  )
  return readJson<StudioVideoGeneration[]>(response)
}

function getFallbackVideoTitle(prompt: string) {
  const normalized = prompt.trim()
  return normalized ? normalized.slice(0, 120) : VIDEO_FALLBACK_TITLE
}

async function createVideoSession(title: string) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "video", title }),
  })
  return readJson<StudioSession>(response)
}

async function generateSessionTitle(sessionId: string, prompt: string) {
  await fetch(`/api/studio/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
}

async function submitVideoGeneration({
  sessionId,
  modelId,
  modelName,
  prompt,
  params,
  openapi,
  fields,
  mediaByField,
}: {
  sessionId: string
  modelId: string
  modelName: string
  prompt: string
  params: Record<string, unknown>
  openapi: NonNullable<StudioVideoModelOption["openapi"]>
  fields: StudioVideoParameterField[]
  mediaByField: Record<string, PendingReferenceImage[]>
}) {
  const media = Object.fromEntries(
    Object.entries(mediaByField).map(([key, attachments]) => [
      key,
      attachments.map(serializeReferenceImage),
    ])
  )
  const attachments = Object.values(mediaByField)
    .flat()
    .map(serializeReferenceImage)

  const response = await fetch(
    `/api/studio/sessions/${sessionId}/video-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        modelName,
        prompt,
        params,
        openapi,
        fields,
        media,
        attachments,
      }),
    }
  )
  return readJson<StudioVideoGeneration>(response)
}

type PendingReferenceImage = {
  id: string
  name: string
  mimeType: string
  dataUrl?: string
  url?: string
}

function serializeReferenceImage(attachment: PendingReferenceImage) {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    dataUrl: attachment.dataUrl,
    url: attachment.url,
  }
}

function getVideoFieldKey(field: StudioVideoParameterField) {
  return field.payloadPath.join(".") || field.name
}

function getMaxReferenceImages(field: StudioVideoParameterField) {
  if (!field.acceptMultiple) {
    return 1
  }

  return field.maxItems ?? MAX_REFERENCE_IMAGES
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getInitialParamsForFields(fields: StudioVideoParameterField[]) {
  const initial: Record<string, unknown> = {}

  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      initial[getVideoFieldKey(field)] = field.defaultValue
    }
  }

  return initial
}

function getStoredModelId(supported: StudioVideoModelOption[]) {
  return getPreferredStudioModelId("video", supported)
}

function isVideoGenerationPending(generation: StudioVideoGeneration) {
  return (
    generation.id.startsWith("pending-") ||
    generation.status === "queued" ||
    generation.status === "running" ||
    (generation.status !== "error" && generation.outputs.length === 0)
  )
}

function getVideoOutputContentUrl(outputId: string, download = false) {
  const suffix = download ? "?download=1" : ""
  return `/api/studio/video-outputs/${encodeURIComponent(outputId)}/content${suffix}`
}

function getVideoOutputSrc(output: StudioVideoOutput) {
  return output.dataUrl ?? getVideoOutputContentUrl(output.id)
}

function StudioVideoWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioVideoWorkbenchProps) {
  const { locale } = useI18n()
  const copy = React.useMemo(() => getVideoCopy(locale), [locale])
  const [models, setModels] = React.useState<{
    supported: StudioVideoModelOption[]
    disabled: StudioVideoModelOption[]
  }>({ supported: [], disabled: [] })
  const [modelsLoading, setModelsLoading] = React.useState(true)
  const [modelsError, setModelsError] = React.useState("")
  const [modelRefreshNonce, setModelRefreshNonce] = React.useState(0)
  const [selectedModelId, setSelectedModelId] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [paramValues, setParamValues] = React.useState<Record<string, unknown>>(
    {}
  )
  const [mediaByField, setMediaByField] = React.useState<
    Record<string, PendingReferenceImage[]>
  >({})
  const [referenceUrlByField, setReferenceUrlByField] = React.useState<
    Record<string, string>
  >({})
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [submitError, setSubmitError] = React.useState("")
  const [generations, setGenerations] = React.useState<StudioVideoGeneration[]>(
    []
  )
  const generationsRef = React.useRef(generations)
  const hasPendingGeneration = generations.some(isVideoGenerationPending)

  React.useEffect(() => {
    generationsRef.current = generations
  }, [generations])

  const selectedModel = React.useMemo(
    () => models.supported.find((option) => option.id === selectedModelId),
    [models.supported, selectedModelId]
  )

  const fields = selectedModel?.fields ?? []
  const promptField = fields.find(
    (field) => field.name === "prompt" || field.name === "text"
  )
  const imageFields = fields.filter(
    (field) => field.kind === "image" && !field.hidden
  )
  const missingRequiredImageField = imageFields.some(
    (field) => field.required && !mediaByField[getVideoFieldKey(field)]?.length
  )

  React.useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setModelsLoading(true)
      setModelsError("")

      fetchStudioModelsWithCache("video", fetchVideoModels, {
        force: modelRefreshNonce > 0,
      })
        .then((data) => {
          if (cancelled) return
          setModels(data)
          const next = getStoredModelId(data.supported)
          setSelectedModelId(next)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setModelsError(
            error instanceof Error ? error.message : copy.modelsFailed
          )
        })
        .finally(() => {
          if (!cancelled) {
            setModelsLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [copy.modelsFailed, modelRefreshNonce])

  React.useEffect(() => {
    function handleProjectChanged() {
      setModelRefreshNonce((value) => value + 1)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [])

  React.useEffect(() => {
    if (!selectedModel) {
      queueMicrotask(() => setParamValues({}))
      return
    }
    const next = getInitialParamsForFields(selectedModel.fields)
    queueMicrotask(() => {
      setParamValues(next)
      setMediaByField({})
      setReferenceUrlByField({})
    })
  }, [selectedModel])

  React.useEffect(() => {
    if (typeof window === "undefined" || !selectedModelId) return
    saveSelectedStudioModel("video", selectedModelId)
  }, [selectedModelId])

  const reloadGenerations = React.useCallback(
    async (
      activeSessionId: string,
      options: { clearOnError?: boolean } = {}
    ) => {
      try {
        const next = await fetchVideoGenerations(activeSessionId)
        setGenerations(next)
      } catch {
        if (options.clearOnError ?? true) {
          setGenerations([])
        }
      }
    },
    []
  )

  React.useEffect(() => {
    if (!sessionId) {
      queueMicrotask(() => setGenerations([]))
      return
    }
    queueMicrotask(() => {
      void reloadGenerations(sessionId)
    })
  }, [sessionId, reloadGenerations])

  React.useEffect(() => {
    if (!sessionId || !hasPendingGeneration) {
      return
    }

    const interval = window.setInterval(() => {
      if (!generationsRef.current.some(isVideoGenerationPending)) {
        return
      }
      void reloadGenerations(sessionId, { clearOnError: false })
    }, 5_000)

    return () => window.clearInterval(interval)
  }, [hasPendingGeneration, sessionId, reloadGenerations])

  function updateParam(field: StudioVideoParameterField, value: unknown) {
    setParamValues((current) => ({
      ...current,
      [getVideoFieldKey(field)]: value,
    }))
  }

  async function addLocalFiles(
    field: StudioVideoParameterField,
    files: FileList | null
  ) {
    if (!files || files.length === 0) return
    const fieldKey = getVideoFieldKey(field)
    const maxFiles = getMaxReferenceImages(field)
    const imageFiles = Array.from(files).filter(
      (file) =>
        file.type.startsWith("image/") && file.size <= MAX_REFERENCE_BYTES
    ).slice(0, maxFiles)

    if (imageFiles.length === 0) return

    const next: PendingReferenceImage[] = await Promise.all(
      imageFiles.map(async (file) => ({
        id: createClientId(),
        name: file.name,
        mimeType: file.type,
        dataUrl: await readFileAsDataUrl(file),
      }))
    )

    setMediaByField((current) =>
      {
        const existing = current[fieldKey] ?? []
        return {
          ...current,
          [fieldKey]: [...existing, ...next].slice(0, maxFiles),
        }
      }
    )
  }

  function addUrlAttachment(field: StudioVideoParameterField) {
    const fieldKey = getVideoFieldKey(field)
    const trimmed = referenceUrlByField[fieldKey]?.trim() ?? ""
    if (!trimmed) return
    setMediaByField((current) => {
      const existing = current[fieldKey] ?? []
      return {
        ...current,
        [fieldKey]: [
          ...existing,
          {
            id: createClientId(),
            name: trimmed,
            mimeType: "image/url",
            url: trimmed,
          },
        ].slice(0, getMaxReferenceImages(field)),
      }
    })
    setReferenceUrlByField((current) => ({ ...current, [fieldKey]: "" }))
  }

  function removeAttachment(field: StudioVideoParameterField, id: string) {
    const fieldKey = getVideoFieldKey(field)
    setMediaByField((current) => ({
      ...current,
      [fieldKey]: (current[fieldKey] ?? []).filter(
        (attachment) => attachment.id !== id
      ),
    }))
  }

  async function handleSubmit() {
    if (!selectedModel || !selectedModel.openapi || !prompt.trim()) return

    setSubmitError("")

    const optimisticId = `pending-${createClientId()}`
    const promptText = prompt.trim()
    const promptModel = selectedModel
    const promptOpenapi = selectedModel.openapi
    const promptParams = paramValues
    const promptMediaByField = mediaByField
    const isNewSession = !sessionId

    const optimistic: StudioVideoGeneration = {
      id: optimisticId,
      sessionId,
      modelSquareId: promptModel.id,
      modelName: promptModel.name,
      manufacturer: promptModel.manufacturer,
      openapiFile: promptOpenapi.file,
      operationId: promptOpenapi.operationId,
      providerTaskId: null,
      providerRequestId: null,
      prompt: promptText,
      params: promptParams,
      status: "running",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      outputs: [],
    }

    setGenerations((current) => [...current, optimistic])
    setMediaByField({})
    setReferenceUrlByField({})

    void (async () => {
      try {
        let activeSessionId = sessionId
        if (!activeSessionId) {
          const session = await createVideoSession(
            getFallbackVideoTitle(promptText)
          )
          activeSessionId = session.id
          onSessionChange(activeSessionId)
          onSessionsChange()
        }

        if (isNewSession) {
          void generateSessionTitle(activeSessionId, promptText)
            .then(() => onSessionsChange())
            .catch(() => {
              // Keep the prompt-based fallback title on failure.
            })
        }

        const result = await submitVideoGeneration({
          sessionId: activeSessionId,
          modelId: promptModel.id,
          modelName: promptModel.name,
          prompt: promptText,
          params: promptParams,
          openapi: promptOpenapi,
          fields: promptModel.fields,
          mediaByField: promptMediaByField,
        })

        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId ? result : generation
          )
        )
        onSessionsChange()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : copy.submitFailed
        setSubmitError(message)
        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId
              ? { ...generation, status: "error", errorMessage: message }
              : generation
          )
        )
      }
    })()
  }

  function loadOutputIntoForm(generation: StudioVideoGeneration) {
    if (
      !models.supported.some((option) => option.id === generation.modelSquareId)
    ) {
      return
    }
    setSelectedModelId(generation.modelSquareId)
    setPrompt(generation.prompt)
    setParamValues(generation.params ?? {})
  }

  function downloadOutput(output: StudioVideoOutput) {
    const href = output.dataUrl ?? getVideoOutputContentUrl(output.id, true)
    if (!href) return
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `video-${output.id}.mp4`
    anchor.rel = "noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background xl:flex-row">
      <aside className="flex max-h-[min(44vh,30rem)] min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b bg-background px-4 py-4 xl:h-full xl:max-h-none xl:w-[380px] xl:border-r xl:border-b-0">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {copy.model}
          </label>
          <Select
            value={selectedModelId}
            onValueChange={(value) => setSelectedModelId(value)}
            disabled={modelsLoading || models.supported.length === 0}
          >
            <SelectTrigger className="w-full rounded-2xl">
              <SelectValue
                placeholder={
                  modelsLoading
                    ? copy.modelsLoading
                    : copy.modelPlaceholder
                }
              />
            </SelectTrigger>
            <SelectContent>
              {models.supported.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          {promptField ? (
            <ParameterLabel field={promptField} label={copy.prompt} />
          ) : (
            <label className="text-xs font-medium text-muted-foreground">
              {copy.prompt}
            </label>
          )}
          <Textarea
            id="studio-video-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={copy.promptPlaceholder}
            className="min-h-24 resize-none rounded-2xl"
          />
        </div>

        {imageFields.map((field) => {
          const fieldKey = getVideoFieldKey(field)
          return (
            <ReferenceImagesField
              key={fieldKey}
              attachments={mediaByField[fieldKey] ?? []}
              referenceUrl={referenceUrlByField[fieldKey] ?? ""}
              onUrlChange={(value) =>
                setReferenceUrlByField((current) => ({
                  ...current,
                  [fieldKey]: value,
                }))
              }
              onAddUrl={() => addUrlAttachment(field)}
              onAddFiles={(files) => addLocalFiles(field, files)}
              onRemove={(id) => removeAttachment(field, id)}
              field={field}
            />
          )
        })}

        <div className="mt-4 flex flex-col gap-3">
          {fields
            .filter((field) => !field.advanced && !field.hidden)
            .filter(
              (field) =>
                field.name !== "prompt" &&
                field.name !== "text" &&
                field.name !== "model" &&
                field.kind !== "image"
            )
            .map((field) => (
              <ParameterControl
                key={getVideoFieldKey(field)}
                field={field}
                value={paramValues[getVideoFieldKey(field)]}
                onChange={(value) => updateParam(field, value)}
              />
            ))}
        </div>

        {fields.some((field) => field.advanced && !field.hidden) ? (
          <div className="mt-3 flex flex-col gap-3 border-t pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? copy.advancedHide : copy.advanced}
            </button>
            {showAdvanced
              ? fields
                  .filter((field) => field.advanced && !field.hidden)
                  .filter((field) => field.kind !== "image")
                  .map((field) => (
                    <ParameterControl
                      key={getVideoFieldKey(field)}
                      field={field}
                      value={paramValues[getVideoFieldKey(field)]}
                      onChange={(value) => updateParam(field, value)}
                    />
                  ))
              : null}
          </div>
        ) : null}

        {submitError ? (
          <p className="mt-3 text-xs text-destructive">{submitError}</p>
        ) : null}

        <Button
          type="button"
          className="mt-4 h-10 rounded-2xl"
          onClick={handleSubmit}
          disabled={
            !selectedModel ||
            !selectedModel.openapi ||
            !prompt.trim() ||
            missingRequiredImageField ||
            models.supported.length === 0
          }
        >
          <span>{copy.generate}</span>
        </Button>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-4">
        <OutputCanvas
          generations={generations}
          onSelectGeneration={loadOutputIntoForm}
          onDownloadOutput={downloadOutput}
        />
      </div>
    </section>
  )
}

type ParameterControlProps = {
  field: StudioVideoParameterField
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

type ParameterLabelProps = {
  field: StudioVideoParameterField
  label?: string
  className?: string
}

function ParameterLabel({ field, label, className }: ParameterLabelProps) {
  const description = field.description?.trim()

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate text-xs font-medium text-muted-foreground">
        {label ?? field.label}
      </span>
      {description ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3"
              aria-label={`${label ?? field.label} description`}
            >
              <RiQuestionLine aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="max-h-[min(60vh,22rem)] w-72 gap-2 overflow-y-auto rounded-2xl p-3 text-xs leading-relaxed"
          >
            <p className="font-medium text-foreground">
              {label ?? field.label}
            </p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {description}
            </p>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

function ParameterControl({
  field,
  value,
  onChange,
  disabled,
}: ParameterControlProps) {
  const suggestionListId = React.useId()

  if (field.kind === "boolean") {
    const next = Boolean(value)
    return (
      <div className="flex items-center justify-between gap-2">
        <ParameterLabel field={field} />
        <Toggle
          pressed={next}
          onPressedChange={(pressed) => onChange(pressed)}
          disabled={disabled}
          className="rounded-2xl"
        >
          {next ? "ON" : "OFF"}
        </Toggle>
      </div>
    )
  }

  if (field.kind === "select" && field.options && field.options.length > 0) {
    const noneSentinel = "__none__"
    const selected =
      typeof value === "string" && value.length > 0 ? value : noneSentinel
    const canClear = !field.required
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Select
          value={selected}
          onValueChange={(next) => onChange(next === noneSentinel ? "" : next)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full rounded-2xl">
            <SelectValue placeholder={field.label} />
          </SelectTrigger>
          <SelectContent>
            {canClear ? (
              <SelectItem value={noneSentinel}>—</SelectItem>
            ) : null}
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.kind === "slider") {
    const min = field.min ?? 0
    const max = field.max ?? 100
    const step = field.step ?? 1
    const numeric =
      typeof value === "number"
        ? value
        : Number(value ?? field.defaultValue ?? min)
    const safe = Number.isFinite(numeric) ? numeric : min
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <ParameterLabel field={field} />
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={safe}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-7 w-20 rounded-xl text-xs"
            disabled={disabled}
          />
        </div>
        <Slider
          min={min}
          max={max}
          step={step}
          value={[safe]}
          onValueChange={(next) => onChange(next[0])}
          disabled={disabled}
        />
      </div>
    )
  }

  if (field.kind === "number") {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? value : ""
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Input
          type="number"
          value={numeric as number | string}
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
          className="h-9 rounded-2xl"
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ParameterLabel field={field} />
      <Input
        list={field.suggestedValues?.length ? suggestionListId : undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-2xl"
        disabled={disabled}
      />
      {field.suggestedValues?.length ? (
        <datalist id={suggestionListId}>
          {field.suggestedValues.map((option) => (
            <option
              key={option.value}
              value={option.value}
              label={option.label}
            />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

type ReferenceImagesFieldProps = {
  attachments: PendingReferenceImage[]
  referenceUrl: string
  onUrlChange: (value: string) => void
  onAddUrl: () => void
  onAddFiles: (files: FileList | null) => void
  onRemove: (id: string) => void
  field?: StudioVideoParameterField
  disabled?: boolean
}

function ReferenceImagesField({
  attachments,
  referenceUrl,
  onUrlChange,
  onAddUrl,
  onAddFiles,
  onRemove,
  field,
  disabled,
}: ReferenceImagesFieldProps) {
  const { locale, t } = useI18n()
  const copy = getVideoCopy(locale)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const maxFiles = field ? getMaxReferenceImages(field) : MAX_REFERENCE_IMAGES
  const acceptUrl = field?.acceptUrl !== false

  return (
    <div className="mt-4 flex flex-col gap-2">
      {field ? (
        <ParameterLabel field={field} />
      ) : (
        <span className="text-xs font-medium text-muted-foreground">
          {copy.references}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="group relative size-16 overflow-hidden rounded-2xl border bg-muted"
          >
            {attachment.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex h-full items-center justify-center px-1 text-[10px] text-muted-foreground">
                URL
              </span>
            )}
            <button
              type="button"
              className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition group-hover:opacity-100 [&_svg]:size-3.5"
              onClick={() => onRemove(attachment.id)}
              aria-label={t.studioRemoveAttachment}
              disabled={disabled}
            >
              <RiCloseLine aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={field?.acceptMultiple ?? true}
          className="hidden"
          onChange={(event) => {
            onAddFiles(event.target.files)
            event.target.value = ""
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-2xl"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachments.length >= maxFiles}
        >
          <RiAddLine aria-hidden />
          <span>{copy.attach}</span>
        </Button>
      </div>
      {acceptUrl ? (
        <div className="flex gap-2">
          <Input
            value={referenceUrl}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder={copy.referenceUrl}
            className="h-9 rounded-2xl"
            disabled={disabled || attachments.length >= maxFiles}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-2xl"
            onClick={onAddUrl}
            disabled={
              disabled ||
              !referenceUrl.trim() ||
              attachments.length >= maxFiles
            }
          >
            {copy.addUrl}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

type CanvasTile =
  | {
      kind: "output"
      key: string
      generation: StudioVideoGeneration
      output: StudioVideoOutput
    }
  | {
      kind: "pending"
      key: string
      generation: StudioVideoGeneration
    }
  | {
      kind: "error"
      key: string
      generation: StudioVideoGeneration
    }

function buildCanvasTiles(generations: StudioVideoGeneration[]): CanvasTile[] {
  const tiles: CanvasTile[] = []

  for (const generation of generations) {
    if (generation.outputs.length === 0) {
      if (generation.status === "queued" || generation.status === "running") {
        tiles.push({
          kind: "pending",
          key: `pending-${generation.id}`,
          generation,
        })
      } else if (generation.status === "error") {
        tiles.push({
          kind: "error",
          key: `error-${generation.id}`,
          generation,
        })
      }
      continue
    }

    for (const output of generation.outputs) {
      tiles.push({
        kind: "output",
        key: output.id,
        generation,
        output,
      })
    }
  }

  return tiles
}

function getOutputGridClassName(count: number) {
  if (count <= 1) {
    return "max-w-5xl grid-cols-1"
  }

  if (count === 2) {
    return "max-w-6xl grid-cols-1 xl:grid-cols-2"
  }

  return "max-w-7xl grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3"
}

type OutputCanvasProps = {
  generations: StudioVideoGeneration[]
  onSelectGeneration: (generation: StudioVideoGeneration) => void
  onDownloadOutput: (output: StudioVideoOutput) => void
}

function OutputCanvas({
  generations,
  onSelectGeneration,
  onDownloadOutput,
}: OutputCanvasProps) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const tiles = React.useMemo(
    () => buildCanvasTiles(generations),
    [generations]
  )

  if (tiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto grid w-full gap-4 pb-4",
          getOutputGridClassName(tiles.length)
        )}
      >
        {tiles.map((tile) =>
          tile.kind === "output" ? (
            <CanvasOutputTile
              key={tile.key}
              generation={tile.generation}
              output={tile.output}
              onSelect={() => onSelectGeneration(tile.generation)}
              onDownload={() => onDownloadOutput(tile.output)}
            />
          ) : tile.kind === "error" ? (
            <CanvasErrorTile
              key={tile.key}
              generation={tile.generation}
              onSelect={() => onSelectGeneration(tile.generation)}
            />
          ) : (
            <CanvasPendingTile
              key={tile.key}
              generation={tile.generation}
            />
          )
        )}
      </div>
    </div>
  )
}

type CanvasOutputTileProps = {
  generation: StudioVideoGeneration
  output: StudioVideoOutput
  onSelect: () => void
  onDownload: () => void
}

function CanvasOutputTile({
  generation,
  output,
  onSelect,
  onDownload,
}: CanvasOutputTileProps) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const src = getVideoOutputSrc(output)
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const loaded = loadedSrc === src
  const failed = failedSrc === src

  return (
    <div className="group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-muted shadow-sm">
      <div
        onDoubleClick={onSelect}
        className="relative aspect-video min-h-64 overflow-hidden bg-black"
      >
        {!loaded && !failed ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
            <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
              <div className="size-10 animate-pulse rounded-full border bg-background" />
              <p className="max-w-48 truncate font-mono text-[10px]">
                {output.id}
              </p>
            </div>
          </div>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
            <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
              <RiErrorWarningLine
                className="size-8 text-destructive"
                aria-hidden
              />
              <p className="text-xs">{copy.mediaFailed}</p>
            </div>
          </div>
        ) : null}
        {src && !failed ? (
          <VideoPlayer
            src={src}
            aria-label={generation.prompt}
            autoHide={false}
            className={cn(
              "size-full rounded-none transition-opacity",
              loaded ? "opacity-100" : "opacity-0"
            )}
            onLoadedData={() => setLoadedSrc(src)}
            onLoadedMetadata={() => setLoadedSrc(src)}
            onError={() => setFailedSrc(src)}
            playsInline
            preload="metadata"
            size="full"
          />
        ) : null}
      </div>

      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-2 text-white">
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-xs font-medium">
            {generation.prompt}
          </p>
          <p className="truncate text-[10px] text-white/75">
            {generation.modelName}
          </p>
        </div>
        <StatusBadge generation={generation} />
      </div>

      <div className="absolute top-12 right-2 flex items-center gap-1.5 rounded-full bg-black/60 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2 text-xs text-white hover:bg-white/15"
          onClick={(event) => {
            event.stopPropagation()
            onDownload()
          }}
        >
          <RiDownloadLine aria-hidden />
          <span>{copy.download}</span>
        </Button>
      </div>
    </div>
  )
}

function CanvasPendingTile({
  generation,
}: {
  generation: StudioVideoGeneration
}) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)

  return (
    <div className="relative flex aspect-video min-h-64 flex-col overflow-hidden rounded-2xl border border-primary/20 bg-card text-foreground shadow-sm">
      <div className="absolute inset-0 animate-pulse bg-muted/50" />
      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full border bg-background shadow-sm">
            <RiLoader4Line
              className="size-9 animate-spin text-primary"
              aria-hidden
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium">{copy.generatingTitle}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {generation.prompt}
            </p>
            <p className="text-xs text-muted-foreground">
              {copy.generatingHint}
            </p>
          </div>
        </div>
      </div>
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/30 to-transparent p-2 text-xs">
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-medium text-foreground">
            {generation.prompt}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {generation.modelName}
          </p>
        </div>
        <StatusBadge generation={generation} />
      </div>
    </div>
  )
}

function CanvasErrorTile({
  generation,
  onSelect,
}: {
  generation: StudioVideoGeneration
  onSelect: () => void
}) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const message = generation.errorMessage?.trim() || copy.errorFallback

  return (
    <div
      onDoubleClick={onSelect}
      className="relative flex aspect-video min-h-64 flex-col overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5 text-foreground shadow-sm"
    >
      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-xl flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full border border-destructive/30 bg-background text-destructive shadow-sm">
            <RiErrorWarningLine className="size-9" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2">
            <p className="text-sm font-medium text-destructive">
              {copy.errorTitle}
            </p>
            <p className="line-clamp-2 max-w-full text-xs text-muted-foreground">
              {generation.prompt}
            </p>
            <p className="max-h-28 max-w-full overflow-y-auto break-words rounded-xl border border-destructive/20 bg-background/80 px-3 py-2 text-xs leading-relaxed text-destructive">
              {message}
            </p>
          </div>
        </div>
      </div>
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 bg-gradient-to-b from-background/90 to-transparent p-2 text-xs">
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-medium text-foreground">
            {generation.prompt}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {generation.modelName}
          </p>
        </div>
        <StatusBadge generation={generation} />
      </div>
    </div>
  )
}

function StatusBadge({ generation }: { generation: StudioVideoGeneration }) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const labelMap: Record<StudioVideoGeneration["status"], string> = {
    queued: copy.queued,
    running: copy.running,
    complete: copy.complete,
    partial: copy.complete,
    error: copy.failed,
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border bg-background/80 px-2 py-0.5 text-[10px]",
        generation.status === "error" &&
          "border-destructive/40 text-destructive",
        generation.status === "complete" &&
          "border-primary/35 text-primary"
      )}
    >
      {labelMap[generation.status]}
    </span>
  )
}

export { StudioVideoWorkbench }
