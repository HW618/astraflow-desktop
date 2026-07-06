"use client"

import * as React from "react"
import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiInformationLine,
  RiKey2Line,
  RiLoader4Line,
  RiPencilLine,
  RiRefreshLine,
  RiSearchLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn } from "@/lib/utils"

type ApiEnvelope<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type ManagedModelverseApiKey = {
  id: string
  name: string
  key?: string
  keyPreview: string
  status: number | null
  createdAt: number | null
  expireTime: number | null
  modelverseDisabled: number | null
  sandboxDisabled: number | null
  dailyLimitAmount: string
  dailyUsedAmount: string
  monthlyLimitAmount: string
  monthlyUsedAmount: string
  grantAllModels: boolean
  grantedModels: string[]
  ipWhitelist: string
}

type SelectedModelverseApiKey = {
  id: string
  name: string
} | null

type ModelverseApiKeysPayload = {
  projectId: string
  items: ManagedModelverseApiKey[]
  selected: SelectedModelverseApiKey
}

type ExaApiKeyPayload = {
  configured: boolean
  updatedAt: string | null
}

type ApiKeyFormState = {
  name: string
  modelverseEnabled: boolean
  sandboxEnabled: boolean
  dailyLimitAmount: string
  monthlyLimitAmount: string
  grantAllModels: boolean
  grantedModelsText: string
  ipWhitelist: string
  useForApp: boolean
}

type ApiKeyStatusFilter = "all" | "active" | "inactive" | "modelverse-off"

type StudioApiSettingsPageProps = {
  onSelectedKeyChange?: (configured: boolean) => void
  embedded?: boolean
}

const emptyForm: ApiKeyFormState = {
  name: "",
  modelverseEnabled: true,
  sandboxEnabled: true,
  dailyLimitAmount: "",
  monthlyLimitAmount: "",
  grantAllModels: true,
  grantedModelsText: "",
  ipWhitelist: "",
  useForApp: false,
}

class LoginRequiredError extends Error {
  constructor() {
    super("Login required.")
    this.name = "LoginRequiredError"
  }
}

async function apiRequest<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed."
) {
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  })

  if (response.status === 401) {
    throw new LoginRequiredError()
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload && "message" in payload && payload.message
        ? payload.message
        : fallbackMessage
    )
  }

  return payload.data
}

function formatUnixTime(value: number | null, locale?: string) {
  if (!value || value < 0) {
    return "-"
  }

  const timestamp = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatAmount(value: string) {
  return value.trim() || "-"
}

function parseGrantedModels(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error("Granted models must be a JSON array.")
    }

    return parsed
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return trimmed
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toFormState(
  apiKey: ManagedModelverseApiKey,
  useForApp: boolean
): ApiKeyFormState {
  const grantsAll =
    apiKey.grantAllModels || apiKey.grantedModels.includes("all")

  return {
    name: apiKey.name,
    modelverseEnabled: apiKey.modelverseDisabled !== 1,
    sandboxEnabled: apiKey.sandboxDisabled !== 1,
    dailyLimitAmount: apiKey.dailyLimitAmount,
    monthlyLimitAmount: apiKey.monthlyLimitAmount,
    grantAllModels: grantsAll,
    grantedModelsText: grantsAll ? "" : apiKey.grantedModels.join("\n"),
    ipWhitelist: apiKey.ipWhitelist,
    useForApp,
  }
}

function apiKeyMatchesSearch(apiKey: ManagedModelverseApiKey, query: string) {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return true
  }

  return [
    apiKey.id,
    apiKey.name,
    apiKey.keyPreview,
    apiKey.grantedModels.join(" "),
    apiKey.ipWhitelist,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized)
}

function apiKeyMatchesStatus(
  apiKey: ManagedModelverseApiKey,
  statusFilter: ApiKeyStatusFilter
) {
  if (statusFilter === "all") {
    return true
  }

  if (statusFilter === "active") {
    return apiKey.status === 1
  }

  if (statusFilter === "inactive") {
    return apiKey.status !== 1
  }

  return apiKey.modelverseDisabled === 1
}

function checkboxClassName(disabled?: boolean) {
  return cn(
    "mt-0.5 size-4 shrink-0 rounded border-border accent-primary",
    disabled && "cursor-not-allowed opacity-50"
  )
}

function copyWithFallback(value: string) {
  const textarea = document.createElement("textarea")
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)
    selection?.removeAllRanges()
    selectedRanges.forEach((range) => selection?.addRange(range))
    activeElement?.focus({ preventScroll: true })
  }
}

async function writeClipboard(value: string) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back to the legacy copy path below.
    }
  }

  return copyWithFallback(value)
}

function StudioApiSettingsPage({
  embedded = false,
  onSelectedKeyChange,
}: StudioApiSettingsPageProps = {}) {
  const { locale, t } = useI18n()
  const [data, setData] = React.useState<ModelverseApiKeysPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] =
    React.useState<ApiKeyStatusFilter>("all")
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingKeyId, setEditingKeyId] = React.useState("")
  const [form, setForm] = React.useState<ApiKeyFormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] =
    React.useState<ManagedModelverseApiKey | null>(null)
  const [copiedKeyId, setCopiedKeyId] = React.useState("")
  const [exaConfigured, setExaConfigured] = React.useState(false)
  const [exaInput, setExaInput] = React.useState("")
  const [exaSaving, setExaSaving] = React.useState(false)

  const apiKeys = React.useMemo(() => data?.items ?? [], [data?.items])
  const selectedKeyId = data?.selected?.id ?? ""
  const isEditing = Boolean(editingKeyId)
  const isBusy = isSaving || isDeleting
  const visibleKeys = React.useMemo(
    () =>
      apiKeys.filter(
        (apiKey) =>
          apiKeyMatchesSearch(apiKey, search) &&
          apiKeyMatchesStatus(apiKey, statusFilter)
      ),
    [apiKeys, search, statusFilter]
  )

  const redirectToLogin = React.useCallback(() => {
    window.location.replace("/login")
  }, [])

  function showSuccess(message: string) {
    toast.success(t.studioApiSettings, {
      description: message,
    })
  }

  const showError = React.useCallback(
    (message: string) => {
      toast.error(t.studioSandboxError, {
        description: message,
      })
    },
    [t.studioSandboxError]
  )

  const loadSettings = React.useCallback(
    async (preferredProjectId?: string) => {
      try {
        setIsLoading(true)

        const searchParams = preferredProjectId
          ? `?projectId=${encodeURIComponent(preferredProjectId)}`
          : ""
        const [apiKeysPayload, exa] = await Promise.all([
          apiRequest<ModelverseApiKeysPayload>(
            `/api/studio/modelverse-api-keys${searchParams}`,
            undefined,
            t.studioApiKeysLoadFailed
          ),
          apiRequest<ExaApiKeyPayload>(
            "/api/studio/exa-api-key",
            undefined,
            t.studioExaApiKeyError
          ),
        ])

        setData(apiKeysPayload)
        onSelectedKeyChange?.(Boolean(apiKeysPayload.selected))
        setExaConfigured(exa.configured)
        setExaInput("")
      } catch (loadError) {
        if (loadError instanceof LoginRequiredError) {
          redirectToLogin()
          return
        }

        showError(
          loadError instanceof Error
            ? loadError.message
            : t.studioApiKeysLoadFailed
        )
      } finally {
        setIsLoading(false)
      }
    },
    [
      onSelectedKeyChange,
      redirectToLogin,
      showError,
      t.studioApiKeysLoadFailed,
      t.studioExaApiKeyError,
    ]
  )

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadSettings()
    })
  }, [loadSettings])

  React.useEffect(() => {
    function handleProjectChanged(event: Event) {
      const projectId =
        (event as CustomEvent<{ projectId?: string }>).detail?.projectId ?? ""

      setFormOpen(false)
      setEditingKeyId("")
      setForm(emptyForm)
      setDeleteTarget(null)
      void loadSettings(projectId)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [loadSettings])

  function updateForm(next: Partial<ApiKeyFormState>) {
    setForm((current) => ({ ...current, ...next }))
  }

  function openCreateForm() {
    setEditingKeyId("")
    setForm(emptyForm)
    setFormOpen(true)
  }

  function openEditForm(apiKey: ManagedModelverseApiKey) {
    setEditingKeyId(apiKey.id)
    setForm(toFormState(apiKey, selectedKeyId === apiKey.id))
    setFormOpen(true)
  }

  function closeForm() {
    if (isSaving) {
      return
    }

    setFormOpen(false)
    setEditingKeyId("")
    setForm(emptyForm)
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = form.name.trim()

    if (!name) {
      showError(t.studioApiKeyNameRequired)
      return
    }

    let grantedModels: string[]

    try {
      grantedModels = form.grantAllModels
        ? []
        : parseGrantedModels(form.grantedModelsText)
    } catch {
      showError(t.studioApiKeyGrantedModelsInvalid)
      return
    }

    try {
      setIsSaving(true)

      const payload = {
        projectId: data?.projectId,
        name,
        modelverseEnabled: form.modelverseEnabled,
        sandboxEnabled: form.sandboxEnabled,
        dailyLimitAmount: form.dailyLimitAmount.trim(),
        monthlyLimitAmount: form.monthlyLimitAmount.trim(),
        grantAllModels: form.grantAllModels,
        grantedModels,
        ipWhitelist: form.ipWhitelist,
        useForApp: form.useForApp,
      }
      const next = editingKeyId
        ? await apiRequest<ModelverseApiKeysPayload>(
            "/api/studio/modelverse-api-keys",
            {
              method: "PATCH",
              body: JSON.stringify({ ...payload, keyId: editingKeyId }),
            },
            t.studioApiKeyUpdateFailed
          )
        : await apiRequest<ModelverseApiKeysPayload>(
            "/api/studio/modelverse-api-keys",
            {
              method: "POST",
              body: JSON.stringify({ action: "create", ...payload }),
            },
            t.studioApiKeyCreateFailed
          )

      setData(next)
      onSelectedKeyChange?.(Boolean(next.selected))
      setFormOpen(false)
      setEditingKeyId("")
      setForm(emptyForm)
      showSuccess(editingKeyId ? t.studioApiKeyUpdated : t.studioApiKeyCreated)
    } catch (saveError) {
      if (saveError instanceof LoginRequiredError) {
        redirectToLogin()
        return
      }

      showError(
        saveError instanceof Error
          ? saveError.message
          : isEditing
            ? t.studioApiKeyUpdateFailed
            : t.studioApiKeyCreateFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function setApiKeyForApp(apiKey: ManagedModelverseApiKey) {
    if (apiKey.modelverseDisabled === 1) {
      showError(t.studioApiKeyDisabledCannotUse)
      return
    }

    try {
      setIsSaving(true)

      const next = await apiRequest<ModelverseApiKeysPayload>(
        "/api/studio/modelverse-api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            action: "select",
            apiKeyId: apiKey.id,
            projectId: data?.projectId,
          }),
        },
        t.studioApiKeySelectFailed
      )

      setData(next)
      onSelectedKeyChange?.(Boolean(next.selected))
      showSuccess(t.studioApiKeySelected)
    } catch (selectError) {
      if (selectError instanceof LoginRequiredError) {
        redirectToLogin()
        return
      }

      showError(
        selectError instanceof Error
          ? selectError.message
          : t.studioApiKeySelectFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function confirmDelete() {
    const target = deleteTarget

    if (!target) {
      return
    }

    try {
      setIsDeleting(true)

      const next = await apiRequest<ModelverseApiKeysPayload>(
        "/api/studio/modelverse-api-keys",
        {
          method: "DELETE",
          body: JSON.stringify({
            keyId: target.id,
            projectId: data?.projectId,
          }),
        },
        t.studioApiKeyDeleteFailed
      )

      setData(next)
      onSelectedKeyChange?.(Boolean(next.selected))
      setDeleteTarget(null)
      showSuccess(t.studioApiKeyDeleted)

      if (editingKeyId === target.id) {
        setFormOpen(false)
        setEditingKeyId("")
        setForm(emptyForm)
      }
    } catch (deleteError) {
      if (deleteError instanceof LoginRequiredError) {
        redirectToLogin()
        return
      }

      showError(
        deleteError instanceof Error
          ? deleteError.message
          : t.studioApiKeyDeleteFailed
      )
    } finally {
      setIsDeleting(false)
    }
  }

  async function saveExaApiKey(nextApiKey = exaInput) {
    try {
      setExaSaving(true)

      const next = await apiRequest<ExaApiKeyPayload>(
        "/api/studio/exa-api-key",
        {
          method: "POST",
          body: JSON.stringify({ apiKey: nextApiKey }),
        },
        t.studioExaApiKeyError
      )

      setExaConfigured(next.configured)
      setExaInput("")
      showSuccess(
        next.configured ? t.studioExaApiKeySaved : t.studioExaApiKeyCleared
      )
    } catch (saveError) {
      if (saveError instanceof LoginRequiredError) {
        redirectToLogin()
        return
      }

      showError(
        saveError instanceof Error ? saveError.message : t.studioExaApiKeyError
      )
    } finally {
      setExaSaving(false)
    }
  }

  async function copyApiKey(apiKey: ManagedModelverseApiKey) {
    const apiKeyValue = apiKey.key?.trim()

    if (!apiKeyValue) {
      showError(t.studioApiKeySecretHidden)
      return
    }

    const copied = await writeClipboard(apiKeyValue)

    if (!copied) {
      showError(t.requestFailed)
      return
    }

    setCopiedKeyId(apiKey.id)
    window.setTimeout(() => {
      setCopiedKeyId((current) => (current === apiKey.id ? "" : current))
    }, 1600)
  }

  function renderModels(apiKey: ManagedModelverseApiKey) {
    if (apiKey.grantAllModels || apiKey.grantedModels.includes("all")) {
      return t.studioApiKeyAllModels
    }

    if (!apiKey.grantedModels.length) {
      return t.none
    }

    return t.studioApiKeyModelCount(apiKey.grantedModels.length)
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        embedded
          ? "bg-transparent"
          : "min-h-0 flex-1 overflow-hidden bg-background"
      )}
    >
      <main
        className={cn(
          "min-w-0",
          embedded ? "overflow-visible" : "min-h-0 flex-1 overflow-y-auto"
        )}
      >
        <div className={cn("flex flex-col gap-4", !embedded && "p-4 lg:p-6")}>
          <div className="flex flex-col gap-3 rounded-4xl bg-card/70 p-3 shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
                <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={t.studioApiKeySearch}
                  className="pl-9"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.studioApiKeySearch}
                  value={search}
                />
              </div>

              <Select
                onValueChange={(value) =>
                  setStatusFilter(value as ApiKeyStatusFilter)
                }
                value={statusFilter}
              >
                <SelectTrigger aria-label={t.studioApiKeyStatus} size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.studioApiKeyStatusAll}</SelectItem>
                  <SelectItem value="active">
                    {t.studioApiKeyStatusActive}
                  </SelectItem>
                  <SelectItem value="inactive">
                    {t.studioApiKeyStatusInactive}
                  </SelectItem>
                  <SelectItem value="modelverse-off">
                    {t.studioApiKeyStatusModelverseDisabled}
                  </SelectItem>
                </SelectContent>
              </Select>

              <div className="text-sm text-muted-foreground">
                {t.studioApiSettingsSummary(visibleKeys.length, apiKeys.length)}
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  disabled={isLoading}
                  onClick={() => void loadSettings()}
                  size="sm"
                  variant="outline"
                >
                  {isLoading ? (
                    <RiLoader4Line className="animate-spin" />
                  ) : (
                    <RiRefreshLine />
                  )}
                  {t.refresh}
                </Button>
                <Button onClick={openCreateForm} size="sm">
                  <RiAddLine />
                  {t.studioApiKeyNew}
                </Button>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden rounded-4xl py-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[26%]" />
                  <col className="w-[24%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <thead className="border-b bg-muted/35">
                  <tr className="text-center text-xs font-medium text-muted-foreground">
                    <th className="px-3 py-3 font-medium">
                      {t.studioApiKeyName}
                    </th>
                    <th className="px-3 py-3 font-medium">
                      {t.studioApiKeyKeyId}
                    </th>
                    <th className="px-3 py-3 font-medium">
                      {t.studioApiKeyPreview}
                    </th>
                    <th className="px-3 py-3 font-medium">
                      {t.studioApiKeyActions}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td className="h-48 px-3 py-8 text-center" colSpan={4}>
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <RiLoader4Line className="size-4 animate-spin" />
                          {t.studioApiKeyLoading}
                        </div>
                      </td>
                    </tr>
                  ) : visibleKeys.length ? (
                    visibleKeys.map((apiKey) => {
                      const isSelected = selectedKeyId === apiKey.id
                      const modelTitle =
                        apiKey.grantedModels.length > 0
                          ? apiKey.grantedModels.join("\n")
                          : undefined

                      return (
                        <tr
                          className={cn(
                            "text-center transition-colors hover:bg-muted/35",
                            isSelected && "bg-primary/5"
                          )}
                          key={apiKey.id}
                        >
                          <td className="px-3 py-3 align-middle">
                            <div className="flex min-w-0 flex-col items-center gap-1.5">
                              <span
                                className="max-w-full truncate font-medium"
                                title={apiKey.name}
                              >
                                {apiKey.name || "-"}
                              </span>
                              {isSelected ? (
                                <Badge variant="default">
                                  <RiCheckLine />
                                  {t.studioApiKeyInUse}
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <code
                              className="mx-auto block max-w-full truncate rounded-2xl bg-muted px-2 py-1 font-mono text-xs"
                              title={apiKey.id}
                            >
                              {apiKey.id}
                            </code>
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex min-w-0 items-center justify-center gap-1.5">
                              <code
                                className="block max-w-[92px] min-w-0 truncate rounded-2xl bg-muted px-2 py-1 font-mono text-xs"
                                title={t.studioApiKeySecretHidden}
                              >
                                {apiKey.keyPreview || "-"}
                              </code>
                              <Button
                                aria-label={t.studioCopy}
                                disabled={!apiKey.key}
                                onClick={() => void copyApiKey(apiKey)}
                                size="icon-xs"
                                title={t.studioCopy}
                                type="button"
                                variant="ghost"
                              >
                                {copiedKeyId === apiKey.id ? (
                                  <RiCheckLine />
                                ) : (
                                  <RiFileCopyLine />
                                )}
                              </Button>
                            </div>
                          </td>
                          <td className="px-2 py-3 align-middle whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    aria-label={t.studioApiKeyDetails}
                                    size="icon-sm"
                                    title={t.studioApiKeyDetails}
                                    type="button"
                                    variant="outline"
                                  >
                                    <RiInformationLine />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="end"
                                  className="w-80 gap-3 rounded-3xl p-3"
                                >
                                  <PopoverHeader>
                                    <PopoverTitle className="truncate text-sm">
                                      {apiKey.name || "-"}
                                    </PopoverTitle>
                                  </PopoverHeader>

                                  <div className="grid gap-2 text-sm">
                                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/55 px-3 py-2">
                                      <span className="text-muted-foreground">
                                        {t.studioApiKeyStatus}
                                      </span>
                                      <Badge
                                        variant={
                                          apiKey.status === 1
                                            ? "secondary"
                                            : "outline"
                                        }
                                      >
                                        {apiKey.status === 1
                                          ? t.studioApiKeyStatusActive
                                          : t.studioApiKeyStatusInactive}
                                      </Badge>
                                    </div>

                                    <div className="rounded-2xl bg-muted/55 px-3 py-2">
                                      <div className="mb-2 text-muted-foreground">
                                        {t.studioApiKeyAccess}
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        <Badge
                                          variant={
                                            apiKey.modelverseDisabled === 1
                                              ? "outline"
                                              : "secondary"
                                          }
                                        >
                                          {apiKey.modelverseDisabled === 1
                                            ? t.studioApiKeyModelverseOff
                                            : t.studioApiKeyModelverseOn}
                                        </Badge>
                                        <Badge
                                          variant={
                                            apiKey.sandboxDisabled === 1
                                              ? "outline"
                                              : "secondary"
                                          }
                                        >
                                          {apiKey.sandboxDisabled === 1
                                            ? t.studioApiKeySandboxOff
                                            : t.studioApiKeySandboxOn}
                                        </Badge>
                                      </div>
                                    </div>

                                    <div className="grid gap-1 rounded-2xl bg-muted/55 px-3 py-2">
                                      <div className="text-muted-foreground">
                                        {t.studioApiKeyLimits}
                                      </div>
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-muted-foreground">
                                          {t.studioApiKeyDailyShort}
                                        </span>
                                        <span className="font-medium">
                                          {formatAmount(apiKey.dailyUsedAmount)}
                                          /
                                          {formatAmount(apiKey.dailyLimitAmount)}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-muted-foreground">
                                          {t.studioApiKeyMonthlyShort}
                                        </span>
                                        <span className="font-medium">
                                          {formatAmount(
                                            apiKey.monthlyUsedAmount
                                          )}
                                          /
                                          {formatAmount(
                                            apiKey.monthlyLimitAmount
                                          )}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="rounded-2xl bg-muted/55 px-3 py-2">
                                      <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-muted-foreground">
                                          {t.studioApiKeyModels}
                                        </span>
                                        <Badge
                                          variant="outline"
                                          title={modelTitle}
                                        >
                                          {renderModels(apiKey)}
                                        </Badge>
                                      </div>
                                      {apiKey.grantedModels.length > 0 &&
                                      !apiKey.grantedModels.includes("all") ? (
                                        <div className="max-h-24 overflow-y-auto rounded-xl bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
                                          {apiKey.grantedModels.map((model) => (
                                            <div
                                              key={model}
                                              className="truncate"
                                              title={model}
                                            >
                                              {model}
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/55 px-3 py-2">
                                      <span className="text-muted-foreground">
                                        {t.studioApiKeyCreatedAt}
                                      </span>
                                      <span className="font-medium">
                                        {formatUnixTime(
                                          apiKey.createdAt,
                                          locale
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <Button
                                aria-label={t.studioApiKeyUseForApp}
                                disabled={
                                  isBusy ||
                                  isSelected ||
                                  apiKey.modelverseDisabled === 1
                                }
                                onClick={() => void setApiKeyForApp(apiKey)}
                                size="icon-sm"
                                title={t.studioApiKeyUseForApp}
                                variant={isSelected ? "secondary" : "ghost"}
                              >
                                {isSelected ? <RiCheckLine /> : <RiKey2Line />}
                              </Button>
                              <Button
                                aria-label={t.studioApiKeyEdit}
                                disabled={isBusy}
                                onClick={() => openEditForm(apiKey)}
                                size="icon-sm"
                                title={t.studioApiKeyEdit}
                                variant="ghost"
                              >
                                <RiPencilLine />
                              </Button>
                              <Button
                                aria-label={t.studioApiKeyDelete}
                                disabled={isBusy}
                                onClick={() => setDeleteTarget(apiKey)}
                                size="icon-sm"
                                title={t.studioApiKeyDelete}
                                variant="ghost"
                              >
                                <RiDeleteBinLine />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td className="h-48 px-3 py-8 text-center" colSpan={4}>
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {apiKeys.length
                              ? t.studioApiKeyNoMatches
                              : t.studioApiKeyNoKeys}
                          </span>
                          {!apiKeys.length ? (
                            <span>{t.studioApiKeyEmptyHint}</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="rounded-4xl" size="sm">
            <CardHeader>
              <CardTitle>{t.studioExaApiKeyLabel}</CardTitle>
              <CardDescription>{t.studioExaApiKeyHint}</CardDescription>
              <CardAction>
                <Badge variant={exaConfigured ? "secondary" : "outline"}>
                  {exaConfigured
                    ? t.studioApiKeyConfigured
                    : t.studioApiKeyNotConfigured}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  className="sm:max-w-md"
                  onChange={(event) => setExaInput(event.target.value)}
                  placeholder={t.studioExaApiKeyPlaceholder}
                  type="password"
                  value={exaInput}
                />
                <div className="flex items-center gap-2">
                  <Button
                    disabled={exaSaving || !exaInput.trim()}
                    onClick={() => void saveExaApiKey()}
                    size="sm"
                  >
                    {exaSaving ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiCheckLine />
                    )}
                    {t.studioExaApiKeySave}
                  </Button>
                  {exaConfigured ? (
                    <Button
                      disabled={exaSaving}
                      onClick={() => void saveExaApiKey("")}
                      size="sm"
                      variant="outline"
                    >
                      {t.studioExaApiKeyClear}
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="!top-0 !right-0 !left-auto !grid !h-svh !max-h-svh !w-[min(36rem,calc(100vw-1rem))] !max-w-none !translate-x-0 !translate-y-0 !grid-rows-[auto_minmax(0,1fr)_auto] !gap-0 !rounded-none !rounded-l-4xl !p-0">
          <DialogHeader className="border-b p-6 pr-16">
            <DialogTitle>
              {isEditing ? t.studioApiKeyEditTitle : t.studioApiKeyCreateTitle}
            </DialogTitle>
            <DialogDescription>{t.studioApiKeyFormHint}</DialogDescription>
          </DialogHeader>

          <form
            className="min-h-0 overflow-y-auto px-6 py-5"
            id="modelverse-api-key-form"
            onSubmit={submitForm}
          >
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="modelverse-api-key-name">
                  {t.studioApiKeyName}
                </FieldLabel>
                <Input
                  autoFocus
                  id="modelverse-api-key-name"
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder={t.studioApiKeyNamePlaceholder}
                  value={form.name}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-3xl border bg-card px-3 py-3">
                  <input
                    checked={form.modelverseEnabled}
                    className={checkboxClassName()}
                    onChange={(event) =>
                      updateForm({ modelverseEnabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {t.studioApiKeyModelverseEnabled}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t.studioApiKeyModelverseOn}
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-3xl border bg-card px-3 py-3">
                  <input
                    checked={form.sandboxEnabled}
                    className={checkboxClassName()}
                    onChange={(event) =>
                      updateForm({ sandboxEnabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {t.studioApiKeySandboxEnabled}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t.studioApiKeySandboxOn}
                    </span>
                  </span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="modelverse-api-key-daily-limit">
                    {t.studioApiKeyDailyLimit}
                  </FieldLabel>
                  <Input
                    id="modelverse-api-key-daily-limit"
                    inputMode="decimal"
                    onChange={(event) =>
                      updateForm({ dailyLimitAmount: event.target.value })
                    }
                    placeholder="100"
                    value={form.dailyLimitAmount}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="modelverse-api-key-monthly-limit">
                    {t.studioApiKeyMonthlyLimit}
                  </FieldLabel>
                  <Input
                    id="modelverse-api-key-monthly-limit"
                    inputMode="decimal"
                    onChange={(event) =>
                      updateForm({ monthlyLimitAmount: event.target.value })
                    }
                    placeholder="1000"
                    value={form.monthlyLimitAmount}
                  />
                </Field>
              </div>

              <label className="flex items-start gap-3 rounded-3xl border bg-card px-3 py-3">
                <input
                  checked={form.grantAllModels}
                  className={checkboxClassName()}
                  onChange={(event) =>
                    updateForm({ grantAllModels: event.target.checked })
                  }
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t.studioApiKeyGrantAllModels}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t.studioApiKeyAllModels}
                  </span>
                </span>
              </label>

              <Field data-disabled={form.grantAllModels || undefined}>
                <FieldLabel htmlFor="modelverse-api-key-granted-models">
                  {t.studioApiKeyGrantedModels}
                </FieldLabel>
                <Textarea
                  className="min-h-28"
                  disabled={form.grantAllModels}
                  id="modelverse-api-key-granted-models"
                  onChange={(event) =>
                    updateForm({ grantedModelsText: event.target.value })
                  }
                  placeholder={t.studioApiKeyGrantedModelsPlaceholder}
                  value={form.grantedModelsText}
                />
                <FieldDescription>
                  {t.studioApiKeyGrantedModelsInvalid}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="modelverse-api-key-ip-whitelist">
                  {t.studioApiKeyIpWhitelist}
                </FieldLabel>
                <Textarea
                  className="min-h-28"
                  id="modelverse-api-key-ip-whitelist"
                  onChange={(event) =>
                    updateForm({ ipWhitelist: event.target.value })
                  }
                  placeholder={t.studioApiKeyIpWhitelistPlaceholder}
                  value={form.ipWhitelist}
                />
              </Field>

              <label className="flex items-start gap-3 rounded-3xl border bg-card px-3 py-3">
                <input
                  checked={form.useForApp}
                  className={checkboxClassName(!form.modelverseEnabled)}
                  disabled={!form.modelverseEnabled}
                  onChange={(event) =>
                    updateForm({ useForApp: event.target.checked })
                  }
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t.studioApiKeyUseForApp}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t.studioApiKeyUseAfterSave}
                  </span>
                </span>
              </label>
            </FieldGroup>
          </form>

          <DialogFooter className="border-t p-4">
            <Button
              disabled={isSaving}
              onClick={closeForm}
              type="button"
              variant="outline"
            >
              {t.studioCancel}
            </Button>
            <Button
              disabled={isSaving}
              form="modelverse-api-key-form"
              type="submit"
            >
              {isSaving ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiCheckLine />
              )}
              {isEditing ? t.studioApiKeyUpdate : t.studioApiKeyCreate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.studioApiKeyDeleteTitle}</DialogTitle>
            <DialogDescription>{t.studioApiKeyDeleteConfirm}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <div className="rounded-3xl bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{deleteTarget.name}</span>
              <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                {deleteTarget.id}
              </code>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isDeleting}
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              {t.studioCancel}
            </Button>
            <Button
              disabled={isDeleting}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              {isDeleting ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiDeleteBinLine />
              )}
              {t.studioDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { StudioApiSettingsPage }
