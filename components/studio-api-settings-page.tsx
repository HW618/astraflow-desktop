"use client"

import * as React from "react"
import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiInformationLine,
  RiLoader4Line,
  RiMore2Line,
  RiPencilLine,
  RiRefreshLine,
  RiSearchLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import {
  SettingsEmptyRow,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"

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

type AstraFlowApiKeyPayload = {
  configured: boolean
  keyPreview: string | null
  updatedAt: string | null
  fullKey?: string
}

type AuthStatusPayload = {
  auth: {
    configured: boolean
  }
  oauthConfigured: boolean
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
    year: "numeric",
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

function CheckboxCard({
  checked,
  disabled,
  hint,
  onCheckedChange,
  title,
}: {
  checked: boolean
  disabled?: boolean
  hint: string
  onCheckedChange: (checked: boolean) => void
  title: string
}) {
  return (
    <Label className="flex items-start gap-3 rounded-xl border border-border/70 bg-background px-3 py-2.5 font-normal has-disabled:opacity-60">
      <Checkbox
        checked={checked}
        className="mt-0.5"
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </Label>
  )
}

function DetailItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium">{children}</span>
    </div>
  )
}

function StudioApiSettingsPage() {
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
  const [detailsTarget, setDetailsTarget] =
    React.useState<ManagedModelverseApiKey | null>(null)
  const [astraFlowApiKey, setAstraFlowApiKey] =
    React.useState<AstraFlowApiKeyPayload | null>(null)
  const [astraFlowApiKeyVisible, setAstraFlowApiKeyVisible] =
    React.useState(false)
  const [astraFlowApiKeyCopied, setAstraFlowApiKeyCopied] =
    React.useState(false)
  const [astraFlowApiKeySaving, setAstraFlowApiKeySaving] =
    React.useState(false)
  const [astraFlowApiKeyChangeOpen, setAstraFlowApiKeyChangeOpen] =
    React.useState(false)
  const [astraFlowApiKeyInput, setAstraFlowApiKeyInput] = React.useState("")
  const [ucloudOAuthConfigured, setUcloudOAuthConfigured] =
    React.useState(false)
  const [exaConfigured, setExaConfigured] = React.useState(false)
  const [exaInput, setExaInput] = React.useState("")
  const [exaSaving, setExaSaving] = React.useState(false)

  const copy =
    locale === "zh"
      ? {
          keyCopied: "密钥已复制。",
          summary: (visible: number, total: number) =>
            `${visible} / ${total} 个密钥`,
        }
      : {
          keyCopied: "Key copied.",
          summary: (visible: number, total: number) =>
            `${visible} of ${total} keys`,
        }

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
        const astraFlowKey = await apiRequest<AstraFlowApiKeyPayload>(
          "/api/studio/astraflow-api-key",
          undefined,
          t.studioAstraFlowApiKeyLoadFailed
        )
        const authStatus = await apiRequest<AuthStatusPayload>(
          "/api/studio/oauth/status",
          undefined,
          t.loginStatusLoadFailed
        )

        setAstraFlowApiKey(astraFlowKey)
        setAstraFlowApiKeyVisible(false)
        setAstraFlowApiKeyCopied(false)
        setUcloudOAuthConfigured(authStatus.oauthConfigured)

        if (authStatus.oauthConfigured) {
          try {
            const apiKeysPayload = await apiRequest<ModelverseApiKeysPayload>(
              `/api/studio/modelverse-api-keys${searchParams}`,
              undefined,
              t.studioApiKeysLoadFailed
            )

            setData(apiKeysPayload)
          } catch (apiKeysError) {
            setData({
              projectId: preferredProjectId ?? "",
              items: [],
              selected: null,
            })
            showError(
              apiKeysError instanceof Error
                ? apiKeysError.message
                : t.studioApiKeysLoadFailed
            )
          }
        } else {
          setData({
            projectId: preferredProjectId ?? "",
            items: [],
            selected: null,
          })
        }

        try {
          const exa = await apiRequest<ExaApiKeyPayload>(
            "/api/studio/exa-api-key",
            undefined,
            t.studioExaApiKeyError
          )

          setExaConfigured(exa.configured)
          setExaInput("")
        } catch (exaError) {
          setExaConfigured(false)
          setExaInput("")
          showError(
            exaError instanceof Error
              ? exaError.message
              : t.studioExaApiKeyError
          )
        }
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
      redirectToLogin,
      showError,
      t.studioApiKeysLoadFailed,
      t.studioAstraFlowApiKeyLoadFailed,
      t.studioExaApiKeyError,
      t.loginStatusLoadFailed,
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
      setDetailsTarget(null)
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

  async function saveAstraFlowApiKey() {
    const apiKey = astraFlowApiKeyInput.trim()

    if (!apiKey) {
      showError(t.loginAstraFlowApiKeyRequired)
      return
    }

    try {
      setAstraFlowApiKeySaving(true)
      setAstraFlowApiKeyCopied(false)

      const next = await apiRequest<AstraFlowApiKeyPayload>(
        "/api/studio/astraflow-api-key",
        {
          method: "POST",
          body: JSON.stringify({ apiKey }),
        },
        t.studioAstraFlowApiKeyChangeFailed
      )

      setAstraFlowApiKey(next)
      setAstraFlowApiKeyVisible(false)
      setAstraFlowApiKeyChangeOpen(false)
      setAstraFlowApiKeyInput("")
      showSuccess(t.studioAstraFlowApiKeyChanged)
    } catch (saveError) {
      if (saveError instanceof LoginRequiredError) {
        redirectToLogin()
        return
      }

      showError(
        saveError instanceof Error
          ? saveError.message
          : t.studioAstraFlowApiKeyChangeFailed
      )
    } finally {
      setAstraFlowApiKeySaving(false)
    }
  }

  async function copyAstraFlowApiKey() {
    const fullKey = astraFlowApiKey?.fullKey?.trim()

    if (!fullKey) {
      showError(t.studioAstraFlowApiKeyCopyUnavailable)
      return
    }

    const copied = await writeClipboard(fullKey)

    if (!copied) {
      showError(t.requestFailed)
      return
    }

    setAstraFlowApiKeyCopied(true)
    window.setTimeout(() => {
      setAstraFlowApiKeyCopied(false)
    }, 1600)
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

    toast.success(copy.keyCopied)
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

  const astraFlowApiKeyDisplay =
    astraFlowApiKeyVisible && astraFlowApiKey?.fullKey
      ? astraFlowApiKey.fullKey
      : astraFlowApiKey?.keyPreview || t.studioApiKeyNotConfigured
  const astraFlowApiKeyCopyDisabled =
    !astraFlowApiKey?.fullKey || astraFlowApiKeySaving

  return (
    <SettingsPage>
      <SettingsPageHeader
        busy={isLoading || isBusy}
        description={t.settingsApiKeysDescription}
        title={t.settingsApiKeysNav}
      />

      <SettingsSection
        action={
          <Badge variant={astraFlowApiKey?.configured ? "secondary" : "outline"}>
            {astraFlowApiKey?.configured
              ? t.studioApiKeyConfigured
              : t.studioApiKeyNotConfigured}
          </Badge>
        }
        description={t.studioAstraFlowApiKeyDescription}
        title={t.studioAstraFlowApiKeyTitle}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <code
              className="flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-lg bg-muted px-2.5 font-mono text-[0.8125rem] whitespace-nowrap"
              title={astraFlowApiKeyDisplay}
            >
              <span className="truncate">{astraFlowApiKeyDisplay}</span>
            </code>
            <Button
              aria-label={
                astraFlowApiKeyVisible
                  ? t.studioAstraFlowApiKeyHide
                  : t.studioAstraFlowApiKeyShow
              }
              disabled={!astraFlowApiKey?.configured}
              onClick={() => setAstraFlowApiKeyVisible((current) => !current)}
              size="icon-sm"
              title={
                astraFlowApiKeyVisible
                  ? t.studioAstraFlowApiKeyHide
                  : t.studioAstraFlowApiKeyShow
              }
              type="button"
              variant="ghost"
            >
              {astraFlowApiKeyVisible ? <RiEyeOffLine /> : <RiEyeLine />}
            </Button>
            <Button
              aria-label={t.studioCopy}
              disabled={astraFlowApiKeyCopyDisabled}
              onClick={() => void copyAstraFlowApiKey()}
              size="icon-sm"
              title={t.studioCopy}
              type="button"
              variant="ghost"
            >
              {astraFlowApiKeyCopied ? <RiCheckLine /> : <RiFileCopyLine />}
            </Button>
            <Button
              disabled={astraFlowApiKeySaving}
              onClick={() => setAstraFlowApiKeyChangeOpen(true)}
              size="sm"
              type="button"
              variant={astraFlowApiKey?.configured ? "outline" : "default"}
            >
              {astraFlowApiKeySaving ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiPencilLine data-icon="inline-start" />
              )}
              {astraFlowApiKey?.configured
                ? t.studioAstraFlowApiKeyChange
                : t.studioAstraFlowApiKeyAdd}
            </Button>
          </div>
          <p className="text-[0.8125rem]/5 text-muted-foreground">
            {t.studioAstraFlowApiKeyCurrentHint}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        action={
          <>
            <Button
              aria-label={t.refresh}
              disabled={isLoading}
              onClick={() => void loadSettings()}
              size="icon-sm"
              title={t.refresh}
              type="button"
              variant="ghost"
            >
              <RiRefreshLine
                className={isLoading ? "animate-spin" : undefined}
              />
            </Button>
            <Button
              disabled={!ucloudOAuthConfigured}
              onClick={openCreateForm}
              size="sm"
              type="button"
            >
              <RiAddLine data-icon="inline-start" />
              {t.studioApiKeyNew}
            </Button>
          </>
        }
        description={t.studioApiKeyFormHint}
        title={t.settingsManagedKeysSection}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="relative min-w-0 flex-1 sm:max-w-64">
            <RiSearchLine
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={t.studioApiKeySearch}
              className="h-8 pl-8"
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
              <SelectGroup>
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
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {copy.summary(visibleKeys.length, apiKeys.length)}
          </span>
        </div>

        {isLoading ? (
          <div className="grid gap-3 px-4 py-4">
            {[0, 1, 2].map((index) => (
              <div className="flex items-center justify-between gap-4" key={index}>
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-7 w-20" />
              </div>
            ))}
          </div>
        ) : visibleKeys.length ? (
          visibleKeys.map((apiKey) => {
            const isSelected = selectedKeyId === apiKey.id

            return (
              <div
                className="flex items-center justify-between gap-4 px-4 py-2.5"
                key={apiKey.id}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="truncate text-sm font-medium"
                      title={apiKey.name}
                    >
                      {apiKey.name || "-"}
                    </span>
                    {isSelected ? (
                      <Badge>
                        <RiCheckLine />
                        {t.studioApiKeyInUse}
                      </Badge>
                    ) : null}
                    {apiKey.status !== 1 ? (
                      <Badge variant="outline">
                        {t.studioApiKeyStatusInactive}
                      </Badge>
                    ) : null}
                    {apiKey.modelverseDisabled === 1 ? (
                      <Badge variant="outline">
                        {t.studioApiKeyModelverseOff}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <span className="truncate select-text" title={apiKey.id}>
                      {apiKey.id}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">
                      {apiKey.keyPreview || "-"}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!isSelected ? (
                    <Button
                      disabled={isBusy || apiKey.modelverseDisabled === 1}
                      onClick={() => void setApiKeyForApp(apiKey)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t.studioApiKeyUseForApp}
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={t.studioApiKeyActions}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <RiMore2Line />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onSelect={() => setDetailsTarget(apiKey)}
                        >
                          <RiInformationLine aria-hidden />
                          {t.studioApiKeyDetails}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!apiKey.key}
                          onSelect={() => void copyApiKey(apiKey)}
                        >
                          <RiFileCopyLine aria-hidden />
                          {t.studioCopy}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={isBusy}
                          onSelect={() => openEditForm(apiKey)}
                        >
                          <RiPencilLine aria-hidden />
                          {t.studioApiKeyEdit}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={isBusy}
                          onSelect={() => setDeleteTarget(apiKey)}
                          variant="destructive"
                        >
                          <RiDeleteBinLine aria-hidden />
                          {t.studioApiKeyDelete}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          })
        ) : (
          <SettingsEmptyRow>
            <span className="font-medium text-foreground">
              {apiKeys.length ? t.studioApiKeyNoMatches : t.studioApiKeyNoKeys}
            </span>
            {!apiKeys.length ? <span>{t.studioApiKeyEmptyHint}</span> : null}
          </SettingsEmptyRow>
        )}
      </SettingsSection>

      <SettingsSection
        action={
          <Badge variant={exaConfigured ? "secondary" : "outline"}>
            {exaConfigured
              ? t.studioApiKeyConfigured
              : t.studioApiKeyNotConfigured}
          </Badge>
        }
        description={t.studioExaApiKeyHint}
        title={t.studioExaApiKeyLabel}
      >
        <SettingsRow label={t.studioExaApiKeyLabel}>
          <Input
            className="h-8 w-52"
            onChange={(event) => setExaInput(event.target.value)}
            placeholder={t.studioExaApiKeyPlaceholder}
            type="password"
            value={exaInput}
          />
          <Button
            disabled={exaSaving || !exaInput.trim()}
            onClick={() => void saveExaApiKey()}
            size="sm"
            type="button"
          >
            {exaSaving ? (
              <RiLoader4Line className="animate-spin" data-icon="inline-start" />
            ) : (
              <RiCheckLine data-icon="inline-start" />
            )}
            {t.studioExaApiKeySave}
          </Button>
          {exaConfigured ? (
            <Button
              disabled={exaSaving}
              onClick={() => void saveExaApiKey("")}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.studioExaApiKeyClear}
            </Button>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            closeForm()
          }
        }}
        open={formOpen}
      >
        <SheetContent className="w-full gap-0 p-0 sm:max-w-lg" side="right">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle>
              {isEditing ? t.studioApiKeyEditTitle : t.studioApiKeyCreateTitle}
            </SheetTitle>
            <SheetDescription>{t.studioApiKeyFormHint}</SheetDescription>
          </SheetHeader>

          <form
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
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
                <CheckboxCard
                  checked={form.modelverseEnabled}
                  hint={t.studioApiKeyModelverseOn}
                  onCheckedChange={(modelverseEnabled) =>
                    updateForm({ modelverseEnabled })
                  }
                  title={t.studioApiKeyModelverseEnabled}
                />
                <CheckboxCard
                  checked={form.sandboxEnabled}
                  hint={t.studioApiKeySandboxOn}
                  onCheckedChange={(sandboxEnabled) =>
                    updateForm({ sandboxEnabled })
                  }
                  title={t.studioApiKeySandboxEnabled}
                />
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

              <CheckboxCard
                checked={form.grantAllModels}
                hint={t.studioApiKeyAllModels}
                onCheckedChange={(grantAllModels) =>
                  updateForm({ grantAllModels })
                }
                title={t.studioApiKeyGrantAllModels}
              />

              <Field data-disabled={form.grantAllModels || undefined}>
                <FieldLabel htmlFor="modelverse-api-key-granted-models">
                  {t.studioApiKeyGrantedModels}
                </FieldLabel>
                <Textarea
                  className="min-h-24"
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
                  className="min-h-24"
                  id="modelverse-api-key-ip-whitelist"
                  onChange={(event) =>
                    updateForm({ ipWhitelist: event.target.value })
                  }
                  placeholder={t.studioApiKeyIpWhitelistPlaceholder}
                  value={form.ipWhitelist}
                />
              </Field>

              <CheckboxCard
                checked={form.useForApp}
                disabled={!form.modelverseEnabled}
                hint={t.studioApiKeyUseAfterSave}
                onCheckedChange={(useForApp) => updateForm({ useForApp })}
                title={t.studioApiKeyUseForApp}
              />
            </FieldGroup>
          </form>

          <SheetFooter className="flex-row justify-end border-t px-6 py-4">
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
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiCheckLine data-icon="inline-start" />
              )}
              {isEditing ? t.studioApiKeyUpdate : t.studioApiKeyCreate}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(open) => !open && setDetailsTarget(null)}
        open={Boolean(detailsTarget)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate">
              {detailsTarget?.name || "-"}
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs">
              {detailsTarget?.id}
            </DialogDescription>
          </DialogHeader>
          {detailsTarget ? (
            <div className="divide-y divide-border/60">
              <DetailItem label={t.studioApiKeyStatus}>
                <Badge
                  variant={detailsTarget.status === 1 ? "secondary" : "outline"}
                >
                  {detailsTarget.status === 1
                    ? t.studioApiKeyStatusActive
                    : t.studioApiKeyStatusInactive}
                </Badge>
              </DetailItem>
              <DetailItem label={t.studioApiKeyAccess}>
                <span className="flex flex-wrap justify-end gap-1.5">
                  <Badge
                    variant={
                      detailsTarget.modelverseDisabled === 1
                        ? "outline"
                        : "secondary"
                    }
                  >
                    {detailsTarget.modelverseDisabled === 1
                      ? t.studioApiKeyModelverseOff
                      : t.studioApiKeyModelverseOn}
                  </Badge>
                  <Badge
                    variant={
                      detailsTarget.sandboxDisabled === 1
                        ? "outline"
                        : "secondary"
                    }
                  >
                    {detailsTarget.sandboxDisabled === 1
                      ? t.studioApiKeySandboxOff
                      : t.studioApiKeySandboxOn}
                  </Badge>
                </span>
              </DetailItem>
              <DetailItem label={t.studioApiKeyDailyShort}>
                {formatAmount(detailsTarget.dailyUsedAmount)} /{" "}
                {formatAmount(detailsTarget.dailyLimitAmount)}
              </DetailItem>
              <DetailItem label={t.studioApiKeyMonthlyShort}>
                {formatAmount(detailsTarget.monthlyUsedAmount)} /{" "}
                {formatAmount(detailsTarget.monthlyLimitAmount)}
              </DetailItem>
              <DetailItem label={t.studioApiKeyModels}>
                {renderModels(detailsTarget)}
              </DetailItem>
              {detailsTarget.grantedModels.length > 0 &&
              !detailsTarget.grantedModels.includes("all") ? (
                <div className="max-h-28 overflow-y-auto py-2 font-mono text-xs text-muted-foreground">
                  {detailsTarget.grantedModels.map((model) => (
                    <div className="truncate" key={model} title={model}>
                      {model}
                    </div>
                  ))}
                </div>
              ) : null}
              <DetailItem label={t.studioApiKeyCreatedAt}>
                {formatUnixTime(detailsTarget.createdAt, locale)}
              </DetailItem>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setAstraFlowApiKeyChangeOpen(open)
          if (!open) {
            setAstraFlowApiKeyInput("")
          }
        }}
        open={astraFlowApiKeyChangeOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.studioAstraFlowApiKeyChangeTitle}</DialogTitle>
            <DialogDescription>
              {t.studioAstraFlowApiKeyChangeDescription}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoComplete="off"
            disabled={astraFlowApiKeySaving}
            onChange={(event) => setAstraFlowApiKeyInput(event.target.value)}
            placeholder={t.loginAstraFlowApiKeyPlaceholder}
            type="password"
            value={astraFlowApiKeyInput}
          />
          <DialogFooter>
            <Button
              disabled={astraFlowApiKeySaving}
              onClick={() => setAstraFlowApiKeyChangeOpen(false)}
              type="button"
              variant="outline"
            >
              {t.studioCancel}
            </Button>
            <Button
              disabled={astraFlowApiKeySaving || !astraFlowApiKeyInput.trim()}
              onClick={() => void saveAstraFlowApiKey()}
              type="button"
            >
              {astraFlowApiKeySaving ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiCheckLine data-icon="inline-start" />
              )}
              {t.studioAstraFlowApiKeySave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        open={Boolean(deleteTarget)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.studioApiKeyDeleteTitle}</DialogTitle>
            <DialogDescription>{t.studioApiKeyDeleteConfirm}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <div className="rounded-xl bg-muted px-3 py-2 text-sm">
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
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiDeleteBinLine data-icon="inline-start" />
              )}
              {t.studioDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

export { StudioApiSettingsPage }
