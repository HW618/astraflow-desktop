"use client"

import * as React from "react"
import {
  RiAddLine,
  RiCloseLine,
  RiDownloadLine,
  RiLoader4Line,
  RiQuestionLine,
  RiSaveLine,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  fetchStudioModelsWithCache,
  getPreferredStudioModelId,
  saveSelectedStudioModel,
} from "@/lib/studio-model-cache"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn, createClientId } from "@/lib/utils"
import type {
  StudioImageGeneration,
  StudioImageModelOption,
  StudioImageOutput,
  StudioImageParameterField,
  StudioSession,
} from "@/lib/studio-types"

type StudioImageWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; error?: unknown; message?: string }
type ApiResponse<T> = ApiOk<T> | ApiErr

const MAX_REFERENCE_IMAGES = 6
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024
const IMAGE_FALLBACK_TITLE = "New image"

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

async function fetchImageModels() {
  const response = await fetch("/api/studio/image/models")
  return readJson<{
    supported: StudioImageModelOption[]
    disabled: StudioImageModelOption[]
  }>(response)
}

async function fetchImageGenerations(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/image-generations`
  )
  return readJson<StudioImageGeneration[]>(response)
}

function getFallbackImageTitle(prompt: string) {
  const normalized = prompt.trim()
  return normalized ? normalized.slice(0, 120) : IMAGE_FALLBACK_TITLE
}

async function createImageSession(title: string) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "image", title }),
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

async function submitImageGeneration({
  sessionId,
  modelId,
  modelName,
  operationId,
  prompt,
  params,
  attachments,
}: {
  sessionId: string
  modelId: string
  modelName: string
  operationId?: string
  prompt: string
  params: Record<string, unknown>
  attachments: PendingReferenceImage[]
}) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/image-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        modelName,
        operationId,
        prompt,
        params,
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          url: attachment.url,
        })),
      }),
    }
  )
  return readJson<StudioImageGeneration>(response)
}

async function saveImageOutput(outputId: string) {
  const response = await fetch(
    `/api/studio/image-outputs/${outputId}/save`,
    { method: "POST" }
  )
  return readJson<StudioImageOutput>(response)
}

type PendingReferenceImage = {
  id: string
  name: string
  mimeType: string
  dataUrl?: string
  url?: string
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function isSupportedReferenceImage(file: File) {
  return file.type.startsWith("image/") && file.size <= MAX_REFERENCE_BYTES
}

function getClipboardImageFiles(clipboardData: DataTransfer | null) {
  if (!clipboardData) {
    return []
  }

  const directFiles = Array.from(clipboardData.files).filter(
    isSupportedReferenceImage
  )

  if (directFiles.length > 0) {
    return directFiles
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .filter(isSupportedReferenceImage)
}

function getInitialParamsForFields(fields: StudioImageParameterField[]) {
  const initial: Record<string, unknown> = {}

  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      initial[field.name] = field.defaultValue
    }
  }

  return initial
}

function getStoredModelId(supported: StudioImageModelOption[]) {
  return getPreferredStudioModelId("image", supported)
}

function getImageOutputContentUrl(outputId: string, download = false) {
  const suffix = download ? "?download=1" : ""
  return `/api/studio/image-outputs/${encodeURIComponent(outputId)}/content${suffix}`
}

function getImageOutputSrc(output: StudioImageOutput) {
  return output.dataUrl ?? getImageOutputContentUrl(output.id)
}

function StudioImageWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioImageWorkbenchProps) {
  const { t } = useI18n()
  const [models, setModels] = React.useState<{
    supported: StudioImageModelOption[]
    disabled: StudioImageModelOption[]
  }>({ supported: [], disabled: [] })
  const [modelsLoading, setModelsLoading] = React.useState(true)
  const [modelsError, setModelsError] = React.useState("")
  const [modelRefreshNonce, setModelRefreshNonce] = React.useState(0)
  const [selectedModelId, setSelectedModelId] = React.useState("")
  const [selectedOperationId, setSelectedOperationId] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [paramValues, setParamValues] = React.useState<Record<string, unknown>>(
    {}
  )
  const [attachments, setAttachments] = React.useState<PendingReferenceImage[]>(
    []
  )
  const [referenceUrl, setReferenceUrl] = React.useState("")
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [submitError, setSubmitError] = React.useState("")
  const [generations, setGenerations] = React.useState<StudioImageGeneration[]>(
    []
  )
  const [savingOutputId, setSavingOutputId] = React.useState<string | null>(
    null
  )

  const selectedModel = React.useMemo(
    () => models.supported.find((option) => option.id === selectedModelId),
    [models.supported, selectedModelId]
  )

  const operationOptions = React.useMemo(() => {
    if (!selectedModel) {
      return []
    }

    if (selectedModel.operations?.length) {
      return selectedModel.operations
    }

    return selectedModel.openapi
      ? [
          {
            id: "generation" as const,
            openapi: selectedModel.openapi,
            fields: selectedModel.fields,
            requiresReferenceImages: false,
          },
        ]
      : []
  }, [selectedModel])
  const selectedOperation = React.useMemo(
    () =>
      operationOptions.find((operation) => operation.id === selectedOperationId) ??
      operationOptions[0],
    [operationOptions, selectedOperationId]
  )
  const fields = selectedOperation?.fields ?? []
  const promptField = fields.find((field) => field.name === "prompt")
  const imageField = fields.find(
    (field) => field.kind === "image" && !field.hidden
  )
  const hasImageField = Boolean(imageField)
  const operationRequiresReferenceImages = Boolean(
    selectedOperation?.requiresReferenceImages
  )

  React.useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setModelsLoading(true)
      setModelsError("")

      fetchStudioModelsWithCache("image", fetchImageModels, {
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
            error instanceof Error ? error.message : t.studioImageModelsFailed
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
  }, [modelRefreshNonce, t.studioImageModelsFailed])

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
    if (!selectedOperation) {
      queueMicrotask(() => setParamValues({}))
      return
    }
    const next = getInitialParamsForFields(selectedOperation.fields)
    queueMicrotask(() => setParamValues(next))
  }, [selectedOperation])

  React.useEffect(() => {
    if (typeof window === "undefined" || !selectedModelId) return
    saveSelectedStudioModel("image", selectedModelId)
  }, [selectedModelId])

  React.useEffect(() => {
    queueMicrotask(() => {
      setSelectedOperationId((current) =>
        current &&
        operationOptions.some((operation) => operation.id === current)
          ? current
          : operationOptions[0]?.id ?? ""
      )
    })
  }, [operationOptions])

  const reloadGenerations = React.useCallback(
    async (activeSessionId: string) => {
      try {
        const next = await fetchImageGenerations(activeSessionId)
        setGenerations(next)
      } catch {
        setGenerations([])
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

  function updateParam(name: string, value: unknown) {
    setParamValues((current) => ({ ...current, [name]: value }))
  }

  const addImageFiles = React.useCallback((files: File[]) => {
    const imageFiles = files.filter(isSupportedReferenceImage)

    if (imageFiles.length === 0) return

    void Promise.all(
      imageFiles.map(async (file) => ({
        id: createClientId(),
        name: file.name || "pasted-image.png",
        mimeType: file.type,
        dataUrl: await readFileAsDataUrl(file),
      }))
    )
      .then((next: PendingReferenceImage[]) => {
        setAttachments((current) => {
          const remaining = MAX_REFERENCE_IMAGES - current.length

          if (remaining <= 0) {
            return current
          }

          return [...current, ...next.slice(0, remaining)]
        })
      })
      .catch(() => {
        // Ignore unreadable clipboard/file entries.
      })
  }, [])

  function addLocalFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    addImageFiles(Array.from(files))
  }

  const handlePasteReferenceImage = React.useCallback(
    (clipboardData: DataTransfer | null) => {
      if (!hasImageField || attachments.length >= MAX_REFERENCE_IMAGES) {
        return false
      }

      const imageFiles = getClipboardImageFiles(clipboardData)

      if (imageFiles.length === 0) {
        return false
      }

      addImageFiles(imageFiles)
      return true
    },
    [addImageFiles, attachments.length, hasImageField]
  )

  React.useEffect(() => {
    if (!hasImageField) {
      return
    }

    function handleWindowPaste(event: ClipboardEvent) {
      if (handlePasteReferenceImage(event.clipboardData)) {
        event.preventDefault()
      }
    }

    window.addEventListener("paste", handleWindowPaste)

    return () => {
      window.removeEventListener("paste", handleWindowPaste)
    }
  }, [handlePasteReferenceImage, hasImageField])

  function addUrlAttachment() {
    const trimmed = referenceUrl.trim()
    if (!trimmed) return
    setAttachments((current) =>
      [
        ...current,
        {
          id: createClientId(),
          name: trimmed,
          mimeType: "image/url",
          url: trimmed,
        },
      ].slice(0, MAX_REFERENCE_IMAGES)
    )
    setReferenceUrl("")
  }

  function removeAttachment(id: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    )
  }

  async function handleSubmit() {
    if (
      !selectedModel ||
      !selectedOperation ||
      !prompt.trim() ||
      (operationRequiresReferenceImages && attachments.length === 0)
    ) {
      return
    }

    setSubmitError("")

    const optimisticId = `pending-${createClientId()}`
    const promptText = prompt.trim()
    const promptModel = selectedModel
    const promptOperation = selectedOperation
    const promptParams = paramValues
    const promptAttachments = hasImageField ? attachments : []
    const isNewSession = !sessionId

    const optimistic: StudioImageGeneration = {
      id: optimisticId,
      sessionId,
      modelSquareId: promptModel.id,
      modelName: promptModel.name,
      manufacturer: promptModel.manufacturer,
      openapiFile: promptOperation.openapi.file,
      operationId: promptOperation.openapi.operationId,
      prompt: promptText,
      params: promptParams,
      status: "running",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      outputs: [],
    }

    setGenerations((current) => [...current, optimistic])
    setAttachments([])

    void (async () => {
      try {
        let activeSessionId = sessionId
        if (!activeSessionId) {
          const session = await createImageSession(
            getFallbackImageTitle(promptText)
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

        const result = await submitImageGeneration({
          sessionId: activeSessionId,
          modelId: promptModel.id,
          modelName: promptModel.name,
          operationId: promptOperation.openapi.operationId,
          prompt: promptText,
          params: promptParams,
          attachments: promptAttachments,
        })

        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId ? result : generation
          )
        )
        onSessionsChange()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t.studioImageSubmitFailed
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

  function loadOutputIntoForm(generation: StudioImageGeneration) {
    const model = models.supported.find(
      (option) => option.id === generation.modelSquareId
    )

    if (!model) {
      return
    }

    const operation = model.operations?.find(
      (item) => item.openapi.operationId === generation.operationId
    )

    setSelectedModelId(generation.modelSquareId)
    if (operation) {
      setSelectedOperationId(operation.id)
    }
    setPrompt(generation.prompt)
    setParamValues(generation.params ?? {})
  }

  async function handleSave(outputId: string) {
    setSavingOutputId(outputId)
    try {
      const saved = await saveImageOutput(outputId)
      setGenerations((current) =>
        current.map((generation) => ({
          ...generation,
          outputs: generation.outputs.map((output) =>
            output.id === outputId ? saved : output
          ),
        }))
      )
    } catch {
      // ignore save error silently — user can retry
    } finally {
      setSavingOutputId(null)
    }
  }

  function downloadOutput(output: StudioImageOutput) {
    const href = output.dataUrl ?? getImageOutputContentUrl(output.id, true)
    if (!href) return
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `image-${output.id}.png`
    anchor.rel = "noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  return (
    <section className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r bg-background px-4 py-4 lg:w-[380px]">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t.studioImageModel}
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
                    ? t.studioImageModelsLoading
                    : t.studioImageModelPlaceholder
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

        {operationOptions.length > 1 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t.studioImageOperation}
            </label>
            <ToggleGroup
              type="single"
              value={selectedOperation?.id ?? ""}
              onValueChange={(value) => {
                if (value) {
                  setSelectedOperationId(value)
                }
              }}
              variant="outline"
              size="sm"
              spacing={0}
              className="w-full"
            >
              {operationOptions.map((operation) => (
                <ToggleGroupItem
                  key={operation.id}
                  value={operation.id}
                  className="flex-1"
                  aria-label={
                    operation.id === "edit"
                      ? t.studioImageOperationEdit
                      : t.studioImageOperationGeneration
                  }
                >
                  {operation.id === "edit"
                    ? t.studioImageOperationEdit
                    : t.studioImageOperationGeneration}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-1.5">
          {promptField ? (
            <ParameterLabel field={promptField} label={t.studioImagePrompt} />
          ) : (
            <label className="text-xs font-medium text-muted-foreground">
              {t.studioImagePrompt}
            </label>
          )}
          <Textarea
            id="studio-image-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t.studioImagePromptPlaceholder}
            className="min-h-24 resize-none rounded-2xl"
          />
        </div>

        {hasImageField ? (
          <ReferenceImagesField
            attachments={attachments}
            referenceUrl={referenceUrl}
            onUrlChange={setReferenceUrl}
            onAddUrl={addUrlAttachment}
            onAddFiles={addLocalFiles}
            onRemove={removeAttachment}
            field={imageField}
          />
        ) : null}

        <div className="mt-4 flex flex-col gap-3">
          {fields
            .filter((field) => !field.advanced && !field.hidden)
            .filter(
              (field) =>
                field.name !== "prompt" && field.name !== "model" &&
                field.kind !== "image"
            )
            .map((field) => (
              <ParameterControl
                key={field.name}
                field={field}
                value={paramValues[field.name]}
                onChange={(value) => updateParam(field.name, value)}
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
              {showAdvanced ? t.studioImageAdvancedHide : t.studioImageAdvanced}
            </button>
            {showAdvanced
              ? fields
                  .filter((field) => field.advanced && !field.hidden)
                  .filter((field) => field.kind !== "image")
                  .map((field) => (
                    <ParameterControl
                      key={field.name}
                      field={field}
                      value={paramValues[field.name]}
                      onChange={(value) => updateParam(field.name, value)}
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
            !selectedOperation ||
            !prompt.trim() ||
            (operationRequiresReferenceImages && attachments.length === 0) ||
            models.supported.length === 0
          }
        >
          <span>
            {selectedOperation?.id === "edit"
              ? t.studioImageOperationEdit
              : t.studioImageGenerate}
          </span>
        </Button>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-4">
        <OutputCanvas
          generations={generations}
          savingOutputId={savingOutputId}
          onSelectGeneration={loadOutputIntoForm}
          onSaveOutput={handleSave}
          onDownloadOutput={downloadOutput}
        />
      </div>
    </section>
  )
}

type ParameterControlProps = {
  field: StudioImageParameterField
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

type ParameterLabelProps = {
  field: StudioImageParameterField
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
  field?: StudioImageParameterField
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
  const { t } = useI18n()
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {field ? (
          <ParameterLabel field={field} label={t.studioImageReferences} />
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {t.studioImageReferences}
          </span>
        )}
        <span className="text-xs text-muted-foreground/80">
          {t.studioImagePasteHint}
        </span>
      </div>
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
          multiple
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
          disabled={disabled || attachments.length >= MAX_REFERENCE_IMAGES}
        >
          <RiAddLine aria-hidden />
          <span>{t.studioImageAttach}</span>
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          value={referenceUrl}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder={t.studioImageReferenceUrl}
          className="h-9 rounded-2xl"
          disabled={disabled || attachments.length >= MAX_REFERENCE_IMAGES}
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
            attachments.length >= MAX_REFERENCE_IMAGES
          }
        >
          {t.studioImageAddUrl}
        </Button>
      </div>
    </div>
  )
}

function getOutputGridConfig(count: number) {
  if (count <= 1) {
    return { cols: 1, rows: 1, aspect: "1 / 1" }
  }
  if (count === 2) {
    return { cols: 2, rows: 1, aspect: "2 / 1" }
  }
  if (count === 3) {
    return { cols: 3, rows: 1, aspect: "3 / 1" }
  }
  if (count === 4) {
    return { cols: 2, rows: 2, aspect: "1 / 1" }
  }
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return { cols, rows, aspect: `${cols} / ${rows}` }
}

type CanvasTile =
  | {
      kind: "output"
      key: string
      generation: StudioImageGeneration
      output: StudioImageOutput
    }
  | {
      kind: "pending"
      key: string
      generation: StudioImageGeneration
    }

function buildCanvasTiles(generations: StudioImageGeneration[]): CanvasTile[] {
  const tiles: CanvasTile[] = []

  for (const generation of generations) {
    if (generation.outputs.length === 0 && generation.status === "running") {
      tiles.push({
        kind: "pending",
        key: `pending-${generation.id}`,
        generation,
      })
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

type OutputCanvasProps = {
  generations: StudioImageGeneration[]
  savingOutputId: string | null
  onSelectGeneration: (generation: StudioImageGeneration) => void
  onSaveOutput: (outputId: string) => void
  onDownloadOutput: (output: StudioImageOutput) => void
}

function OutputCanvas({
  generations,
  savingOutputId,
  onSelectGeneration,
  onSaveOutput,
  onDownloadOutput,
}: OutputCanvasProps) {
  const { t } = useI18n()
  const tiles = buildCanvasTiles(generations)

  if (tiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t.studioImageEmpty}</p>
      </div>
    )
  }

  const grid = getOutputGridConfig(tiles.length)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div
        className="grid max-h-full max-w-full gap-3"
        style={{
          aspectRatio: grid.aspect,
          height: "min(100%, 44rem)",
          gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
        }}
      >
        {tiles.map((tile) =>
          tile.kind === "output" ? (
            <CanvasOutputTile
              key={tile.key}
              generation={tile.generation}
              output={tile.output}
              saving={savingOutputId === tile.output.id}
              onSelect={() => onSelectGeneration(tile.generation)}
              onSave={() => onSaveOutput(tile.output.id)}
              onDownload={() => onDownloadOutput(tile.output)}
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
  generation: StudioImageGeneration
  output: StudioImageOutput
  saving: boolean
  onSelect: () => void
  onSave: () => void
  onDownload: () => void
}

function CanvasOutputTile({
  generation,
  output,
  saving,
  onSelect,
  onSave,
  onDownload,
}: CanvasOutputTileProps) {
  const { t } = useI18n()
  const src = getImageOutputSrc(output)
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null)
  const loaded = loadedSrc === src

  return (
    <div className="group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-muted">
      <button
        type="button"
        onClick={onSelect}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!loaded ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
            <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
              <div className="size-10 animate-pulse rounded-full border bg-background" />
              <p className="max-w-48 truncate font-mono text-[10px]">
                {output.id}
              </p>
            </div>
          </div>
        ) : null}
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={generation.prompt}
            className={cn(
              "size-full object-cover transition-opacity",
              loaded ? "opacity-100" : "opacity-0"
            )}
            loading="lazy"
            onLoad={() => setLoadedSrc(src)}
          />
        ) : null}
      </button>

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

      <div className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-full bg-black/60 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
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
          <span>{t.studioImageDownload}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2 text-xs text-white hover:bg-white/15"
          onClick={(event) => {
            event.stopPropagation()
            onSave()
          }}
          disabled={saving}
        >
          {saving ? (
            <RiLoader4Line className="animate-spin" aria-hidden />
          ) : (
            <RiSaveLine aria-hidden />
          )}
          <span>{output.savedAt ? t.studioImageSaved : t.studioImageSave}</span>
        </Button>
      </div>
    </div>
  )
}

function CanvasPendingTile({
  generation,
}: {
  generation: StudioImageGeneration
}) {
  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-muted text-muted-foreground">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/40 to-muted" />
      <div className="relative z-10 flex flex-1 items-center justify-center">
        <RiLoader4Line className="size-8 animate-spin" aria-hidden />
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

function StatusBadge({ generation }: { generation: StudioImageGeneration }) {
  const { t } = useI18n()
  const labelMap: Record<StudioImageGeneration["status"], string> = {
    queued: t.studioImageQueued,
    running: t.studioImageRunning,
    complete: t.studioImageComplete,
    partial: t.studioImageComplete,
    error: t.studioImageFailed,
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border bg-background/80 px-2 py-0.5 text-[10px]",
        generation.status === "error" &&
          "border-destructive/40 text-destructive",
        generation.status === "complete" &&
          "border-emerald-500/40 text-emerald-600"
      )}
    >
      {labelMap[generation.status]}
    </span>
  )
}

export { StudioImageWorkbench }
