"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowRightUpLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeBoxLine,
  RiDatabase2Line,
  RiDeleteBin6Line,
  RiFileCopyLine,
  RiGithubLine,
  RiInformationLine,
  RiLoader4Line,
  RiPauseLine,
  RiPlayLine,
  RiRefreshLine,
  RiRestartLine,
  RiTerminalBoxLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CodeBoxGithubStatus,
  CodeBoxSandbox,
  CodeBoxStatus,
  CodeBoxVolume,
} from "@/lib/codebox-types"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn } from "@/lib/utils"

type SandboxFilter = "all" | "running" | "paused"

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

type GithubDeviceFlow = {
  flowId: string
  userCode: string
  verificationUri: string
  expiresAt: string
  interval: number
}

type GithubPollResult =
  | {
      status: "pending"
      interval?: number
    }
  | {
      status: "expired" | "error"
      message?: string
    }
  | {
      status: "complete"
      github: CodeBoxGithubStatus
    }

type ModelverseApiKeyOption = {
  id: string
  name: string
}

type ModelverseApiKeysResponse = {
  projectId: string
  items: ModelverseApiKeyOption[]
  selected: ModelverseApiKeyOption | null
}

type SaveModelverseApiKeyResponse = {
  projectId: string
  selected: ModelverseApiKeyOption
}

type ConfirmAction =
  | {
      kind: "volume"
      volume: CodeBoxVolume
    }
  | {
      kind: "sandbox"
      sandbox: CodeBoxSandbox
    }

const DEFAULT_VOLUME_NAME = "workspace"

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
  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload?.ok) {
    const message =
      payload && "message" in payload && payload.message
        ? payload.message
        : fallbackMessage

    throw new Error(message)
  }

  return payload.data
}

function formatDate(value: string | null, locale?: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

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

function getSandboxStatusLabel(
  status: CodeBoxSandbox["status"],
  t: ReturnType<typeof useI18n>["t"]
) {
  if (status === "running") {
    return t.codeboxStatusRunning
  }

  if (status === "paused") {
    return t.codeboxStatusPaused
  }

  return t.codeboxStatusUnknown
}

function copyWithFallback(value: string) {
  let eventCopied = false
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return
    }

    event.clipboardData.setData("text/plain", value)
    event.preventDefault()
    eventCopied = true
  }

  document.addEventListener("copy", onCopy)

  try {
    document.execCommand("copy")

    if (eventCopied) {
      return true
    }
  } finally {
    document.removeEventListener("copy", onCopy)
  }

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
  if (copyWithFallback(value)) {
    return true
  }

  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function CodeBoxPage() {
  const { t } = useI18n()
  const [status, setStatus] = React.useState<CodeBoxStatus | null>(null)
  const [volumes, setVolumes] = React.useState<CodeBoxVolume[]>([])
  const [sandboxes, setSandboxes] = React.useState<CodeBoxSandbox[]>([])
  const [selectedVolumeId, setSelectedVolumeId] = React.useState("")
  const [volumeName, setVolumeName] = React.useState(DEFAULT_VOLUME_NAME)
  const [repoUrl, setRepoUrl] = React.useState("")
  const [apiKeys, setApiKeys] = React.useState<ModelverseApiKeyOption[]>([])
  const [selectedApiKeyId, setSelectedApiKeyId] = React.useState("")
  const [isApiKeyLoading, setIsApiKeyLoading] = React.useState(true)
  const [sandboxFilter, setSandboxFilter] = React.useState<SandboxFilter>("all")
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [githubFlow, setGithubFlow] = React.useState<GithubDeviceFlow | null>(
    null
  )
  const [githubDialogOpen, setGithubDialogOpen] = React.useState(false)
  const [githubMessage, setGithubMessage] = React.useState("")
  const [confirmAction, setConfirmAction] =
    React.useState<ConfirmAction | null>(null)

  const showNotice = React.useCallback((message: string) => {
    toast.success(message)
  }, [])

  const selectedVolume = React.useMemo(
    () => volumes.find((volume) => volume.volumeId === selectedVolumeId),
    [selectedVolumeId, volumes]
  )

  const loadData = React.useCallback(async () => {
    setError(null)
    setIsApiKeyLoading(true)

    try {
      const [nextStatus, apiKeyData] = await Promise.all([
        apiRequest<CodeBoxStatus>(
          "/api/codebox/status",
          undefined,
          t.requestFailed
        ),
        apiRequest<ModelverseApiKeysResponse>(
          "/api/studio/modelverse-api-keys",
          undefined,
          t.requestFailed
        ),
      ])
      const apiKeyConfigured = Boolean(apiKeyData.selected)

      setStatus({
        ...nextStatus,
        modelverseApiKey: {
          ...nextStatus.modelverseApiKey,
          configured: apiKeyConfigured,
          name: apiKeyData.selected?.name ?? null,
          projectId: apiKeyData.projectId,
        },
      })
      setApiKeys(apiKeyData.items)
      setSelectedApiKeyId(apiKeyData.selected?.id ?? "")

      if (!apiKeyConfigured) {
        setVolumes([])
        setSandboxes([])
        setSelectedVolumeId("")
        return
      }

      const [nextVolumes, nextSandboxes] = await Promise.all([
        apiRequest<CodeBoxVolume[]>(
          "/api/codebox/volumes",
          undefined,
          t.requestFailed
        ),
        apiRequest<CodeBoxSandbox[]>(
          `/api/codebox/sandboxes?state=${sandboxFilter}`,
          undefined,
          t.requestFailed
        ),
      ])

      setVolumes(nextVolumes)
      setSandboxes(nextSandboxes)
      setSelectedVolumeId((current) => {
        if (
          current &&
          nextVolumes.some((volume) => volume.volumeId === current)
        ) {
          return current
        }

        return nextVolumes[0]?.volumeId ?? ""
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.codeboxLoadFailed
      )
    } finally {
      setIsLoading(false)
      setIsApiKeyLoading(false)
    }
  }, [sandboxFilter, t])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  React.useEffect(() => {
    function handleProjectChanged() {
      setIsLoading(true)
      setSelectedApiKeyId("")
      void loadData()
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [loadData])

  React.useEffect(() => {
    if (!githubFlow) {
      return
    }

    const activeFlow = githubFlow
    let cancelled = false
    let timer: number | undefined
    let nextIntervalSeconds = Math.max(3, activeFlow.interval)

    async function pollGithub() {
      try {
        const result = await apiRequest<GithubPollResult>(
          `/api/codebox/github/device/${activeFlow.flowId}/poll`,
          {
            method: "POST",
          },
          t.requestFailed
        )

        if (cancelled) {
          return
        }

        if (result.status === "pending") {
          if (result.interval) {
            nextIntervalSeconds = Math.max(3, result.interval)
          }

          setGithubMessage(t.codeboxWaitingGithub)
          timer = window.setTimeout(
            () => void pollGithub(),
            nextIntervalSeconds * 1000
          )
          return
        }

        if (result.status === "complete") {
          setStatus((current) =>
            current
              ? {
                  ...current,
                  github: result.github,
                }
              : current
          )
          setGithubMessage(t.codeboxGithubConnected)
          setGithubFlow(null)
          setGithubDialogOpen(false)
          showNotice(t.codeboxGithubInjected)
          void loadData()
          return
        }

        setGithubMessage(result.message ?? t.codeboxGithubStopped)
        setGithubFlow(null)
      } catch (pollError) {
        if (!cancelled) {
          setGithubMessage(
            pollError instanceof Error
              ? pollError.message
              : t.codeboxGithubFailed
          )
          setGithubFlow(null)
        }
      }
    }

    queueMicrotask(() => {
      setGithubMessage(t.codeboxWaitingGithub)
    })
    timer = window.setTimeout(
      () => void pollGithub(),
      nextIntervalSeconds * 1000
    )

    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [githubFlow, loadData, showNotice, t])

  async function refresh() {
    setIsLoading(true)
    await loadData()
  }

  async function selectApiKey(apiKeyId: string) {
    const normalizedApiKeyId = apiKeyId.trim()

    if (!normalizedApiKeyId || normalizedApiKeyId === "__empty") {
      return
    }

    setSelectedApiKeyId(normalizedApiKeyId)
    setBusyAction("save-api-key")
    setError(null)

    try {
      const saved = await apiRequest<SaveModelverseApiKeyResponse>(
        "/api/studio/modelverse-api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            apiKeyId: normalizedApiKeyId,
          }),
        },
        t.requestFailed
      )

      showNotice(t.codeboxApiKeySelected(saved.selected.name))
      await loadData()
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : t.codeboxApiKeySelectFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function createVolume(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusyAction("create-volume")
    setError(null)

    try {
      const volume = await apiRequest<CodeBoxVolume>(
        "/api/codebox/volumes",
        {
          method: "POST",
          body: JSON.stringify({ name: volumeName }),
        },
        t.requestFailed
      )

      setVolumes((current) => [volume, ...current])
      setSelectedVolumeId(volume.volumeId)
      setVolumeName(DEFAULT_VOLUME_NAME)
      showNotice(t.codeboxVolumeReady(volume.name))
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t.codeboxVolumeCreateFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteVolume(volume: CodeBoxVolume) {
    setBusyAction(`delete-volume:${volume.volumeId}`)
    setError(null)

    try {
      await apiRequest<{ volumeId: string }>(
        `/api/codebox/volumes/${volume.volumeId}`,
        {
          method: "DELETE",
        },
        t.requestFailed
      )
      await loadData()
      showNotice(t.codeboxVolumeDeleted(volume.name))
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t.codeboxVolumeDeleteFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function createSandbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedVolumeId) {
      setError(t.codeboxCreateVolumeFirst)
      return
    }

    setBusyAction("create-sandbox")
    setError(null)

    try {
      const sandbox = await apiRequest<CodeBoxSandbox>(
        "/api/codebox/sandboxes",
        {
          method: "POST",
          body: JSON.stringify({
            volumeId: selectedVolumeId,
            repoUrl,
          }),
        },
        t.requestFailed
      )

      setSandboxes((current) => [sandbox, ...current])
      setRepoUrl("")
      const passwordCopied = await copyText(sandbox.password)
      showNotice(
        t.codeboxSandboxReady(
          sandbox.volumeName ?? t.codeboxSelectedVolumeFallback,
          passwordCopied
        )
      )
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t.codeboxSandboxCreateFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function runSandboxAction(
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) {
    setBusyAction(`${action}:${sandbox.sandboxId}`)
    setError(null)

    try {
      await apiRequest<{ sandboxId: string }>(
        `/api/codebox/sandboxes/${sandbox.sandboxId}/${action}`,
        {
          method: "POST",
        },
        t.requestFailed
      )
      await loadData()
      showNotice(t.codeboxSandboxActionCompleted(action))
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t.codeboxSandboxActionFailed(action)
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSandboxAction(
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) {
    if (action === "kill") {
      setConfirmAction({ kind: "sandbox", sandbox })
      return
    }

    await runSandboxAction(sandbox, action)
  }

  async function confirmDestructiveAction() {
    const action = confirmAction

    if (!action) {
      return
    }

    setConfirmAction(null)

    if (action.kind === "volume") {
      await deleteVolume(action.volume)
      return
    }

    await runSandboxAction(action.sandbox, "kill")
  }

  async function startGithubLogin() {
    setBusyAction("github-login")
    setError(null)
    setGithubMessage("")

    try {
      const flow = await apiRequest<GithubDeviceFlow>(
        "/api/codebox/github/device",
        {
          method: "POST",
        },
        t.requestFailed
      )

      setGithubFlow(flow)
      setGithubDialogOpen(true)
      setGithubMessage(t.codeboxWaitingGithub)
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : t.codeboxGithubLoginFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function logoutGithub() {
    setBusyAction("github-logout")
    setError(null)

    try {
      const github = await apiRequest<CodeBoxGithubStatus>(
        "/api/codebox/github/logout",
        {
          method: "POST",
        },
        t.requestFailed
      )

      setStatus((current) =>
        current
          ? {
              ...current,
              github,
            }
          : current
      )
      showNotice(t.codeboxGithubRemoved)
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : t.codeboxGithubLogoutFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function copyText(value: string | null | undefined) {
    if (!value) {
      return false
    }

    return writeClipboard(value)
  }

  return (
    <main className="flex h-[calc(100svh-4rem)] max-h-[calc(100svh-4rem)] min-h-0 flex-col overflow-hidden bg-background">
      <section className="flex min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden">
          {error ? (
            <Alert variant="destructive" className="shrink-0">
              <RiInformationLine />
              <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(280px,0.72fr)_minmax(640px,1.6fr)]">
            <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
              <Panel
                title={t.codeboxVolumesTitle}
                description={t.codeboxVolumeSummary(volumes.length)}
                icon={<RiDatabase2Line className="size-4" aria-hidden />}
                className="flex min-h-0 flex-1 flex-col"
                bodyClassName="flex min-h-0 flex-1 flex-col"
              >
                <form className="flex gap-2" onSubmit={createVolume}>
                  <Input
                    value={volumeName}
                    onChange={(event) => setVolumeName(event.target.value)}
                    placeholder="workspace"
                    className="h-9"
                    disabled={busyAction === "create-volume"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busyAction === "create-volume"}
                  >
                    {busyAction === "create-volume" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiAddLine />
                    )}
                    {t.codeboxCreate}
                  </Button>
                </form>

                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {volumes.length === 0 ? (
                    <EmptyBlock text={t.codeboxEmptyCreateVolume} />
                  ) : (
                    volumes.map((volume) => (
                      <VolumeItem
                        key={volume.volumeId}
                        volume={volume}
                        selected={volume.volumeId === selectedVolumeId}
                        busy={busyAction === `delete-volume:${volume.volumeId}`}
                        onSelect={() => setSelectedVolumeId(volume.volumeId)}
                        onDelete={() =>
                          setConfirmAction({ kind: "volume", volume })
                        }
                      />
                    ))
                  )}
                </div>
              </Panel>

              <Panel
                title="GitHub"
                description={
                  status?.github.configured
                    ? (status.github.login ?? t.codeboxGithubConnectedLabel)
                    : t.codeboxGithubDeviceFlow
                }
                icon={<RiGithubLine className="size-4" aria-hidden />}
                className="shrink-0"
                action={
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      onClick={() => void startGithubLogin()}
                      disabled={busyAction === "github-login"}
                    >
                      {busyAction === "github-login" ? (
                        <RiLoader4Line className="animate-spin" />
                      ) : (
                        <RiGithubLine />
                      )}
                      {status?.github.configured
                        ? t.codeboxReconnect
                        : t.codeboxConnect}
                    </Button>
                    {status?.github.configured ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void logoutGithub()}
                        disabled={busyAction === "github-logout"}
                      >
                        <RiCloseLine />
                        {t.logout}
                      </Button>
                    ) : null}
                  </div>
                }
              >
                {null}
              </Panel>
            </div>

            <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
              <Panel
                title={t.codeboxNewSandboxTitle}
                description={
                  selectedVolume
                    ? t.codeboxMountsVolume(selectedVolume.name)
                    : t.codeboxSelectOrCreateVolume
                }
                icon={<RiTerminalBoxLine className="size-4" aria-hidden />}
                className="shrink-0"
              >
                <p className="mb-3 text-xs text-muted-foreground">
                  {t.codeboxNewSandboxDescription}
                </p>
                <form
                  className="grid gap-3 lg:grid-cols-[minmax(170px,0.75fr)_minmax(160px,0.7fr)_minmax(220px,1.1fr)_auto]"
                  onSubmit={createSandbox}
                >
                  <Select
                    value={selectedApiKeyId || undefined}
                    onValueChange={(value) => {
                      const nextValue = value.trim()

                      if (nextValue && nextValue !== "__empty") {
                        void selectApiKey(nextValue)
                      }
                    }}
                    disabled={
                      isApiKeyLoading ||
                      busyAction === "save-api-key"
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          isApiKeyLoading
                            ? t.codeboxLoadingApiKeys
                            : t.codeboxApiKey
                        }
                      />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="max-h-80"
                      position="popper"
                    >
                      <SelectGroup>
                        {apiKeys.length === 0 ? (
                          <SelectItem value="__empty" disabled>
                            {t.codeboxNoApiKeys}
                          </SelectItem>
                        ) : (
                          apiKeys.map((apiKey) => (
                            <SelectItem key={apiKey.id} value={apiKey.id}>
                              {apiKey.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedVolumeId}
                    onValueChange={setSelectedVolumeId}
                    disabled={volumes.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t.codeboxSelectVolume} />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="max-h-72"
                      position="popper"
                    >
                      <SelectGroup>
                        {volumes.map((volume) => (
                          <SelectItem
                            key={volume.volumeId}
                            value={volume.volumeId}
                          >
                            {volume.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Input
                    type="url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder={t.codeboxRepoPlaceholder}
                    className="h-9"
                  />

                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busyAction === "create-sandbox" ||
                      busyAction === "save-api-key" ||
                      !selectedVolumeId ||
                      !selectedApiKeyId
                    }
                  >
                    {busyAction === "create-sandbox" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiPlayLine />
                    )}
                    {t.codeboxLaunch}
                  </Button>
                </form>
              </Panel>

              <Panel
                title={t.codeboxSandboxesTitle}
                description={t.codeboxSandboxesShown(sandboxes.length)}
                icon={<RiCodeBoxLine className="size-4" aria-hidden />}
                className="flex min-h-0 flex-1 flex-col"
                bodyClassName="min-h-0 flex-1"
                action={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => void refresh()}
                      disabled={isLoading}
                      aria-label={t.codeboxRefreshSandboxes}
                    >
                      <RiRefreshLine
                        className={cn(isLoading && "animate-spin")}
                      />
                    </Button>
                    <Select
                      value={sandboxFilter}
                      onValueChange={(value) =>
                        setSandboxFilter(value as SandboxFilter)
                      }
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">
                            {t.codeboxFilterAll}
                          </SelectItem>
                          <SelectItem value="running">
                            {t.codeboxFilterRunning}
                          </SelectItem>
                          <SelectItem value="paused">
                            {t.codeboxFilterPaused}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                }
              >
                <div className="flex max-h-full min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {isLoading && sandboxes.length === 0 ? (
                    <LoadingBlock />
                  ) : sandboxes.length === 0 ? (
                    <EmptyBlock text={t.codeboxNoSandboxes} />
                  ) : (
                    sandboxes.map((sandbox) => (
                      <SandboxItem
                        key={sandbox.sandboxId}
                        sandbox={sandbox}
                        busyAction={busyAction}
                        onCopy={copyText}
                        onAction={handleSandboxAction}
                      />
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </section>

      <GithubDeviceDialog
        open={githubDialogOpen}
        onOpenChange={setGithubDialogOpen}
        flow={githubFlow}
        message={githubMessage}
        onCopy={copyText}
      />
      <ConfirmActionDialog
        action={confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null)
          }
        }}
        onConfirm={() => void confirmDestructiveAction()}
      />
    </main>
  )
}

function Panel({
  title,
  description,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  icon: React.ReactNode
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const hasBody = React.Children.count(children) > 0

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border bg-card p-4 text-card-foreground shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3",
          hasBody && "mb-3"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      {hasBody ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  )
}

function VolumeItem({
  volume,
  selected,
  busy,
  onSelect,
  onDelete,
}: {
  volume: CodeBoxVolume
  selected: boolean
  busy: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { locale, t } = useI18n()

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-2xl border p-2 transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-background"
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 pl-2 text-left"
        onClick={onSelect}
      >
        <div className="truncate text-sm font-medium">{volume.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatDate(volume.createdAt, locale)} /{" "}
          {t.codeboxSeenAt(formatDate(volume.lastSeenAt, locale))}
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        disabled={busy}
        aria-label={t.codeboxDeleteVolumeAria(volume.name)}
      >
        {busy ? (
          <RiLoader4Line className="animate-spin" />
        ) : (
          <RiDeleteBin6Line />
        )}
      </Button>
    </div>
  )
}

function SandboxItem({
  sandbox,
  busyAction,
  onCopy,
  onAction,
}: {
  sandbox: CodeBoxSandbox
  busyAction: string | null
  onCopy: (value: string | null | undefined) => Promise<boolean>
  onAction: (
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) => Promise<void>
}) {
  const { locale, t } = useI18n()
  const statusLabel = getSandboxStatusLabel(sandbox.status, t)
  const isPaused = sandbox.status === "paused"
  const isRunning = sandbox.status === "running"

  return (
    <article className="rounded-2xl border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-[220px] truncate text-sm font-semibold">
              {sandbox.volumeName ?? sandbox.sandboxId}
            </h3>
            <Badge
              variant={
                isRunning ? "default" : isPaused ? "secondary" : "outline"
              }
            >
              {statusLabel}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {sandbox.sandboxId} /{" "}
            {t.codeboxUpdatedAt(formatDate(sandbox.updatedAt, locale))}
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          {isRunning && sandbox.codeServerUrl ? (
            <Button asChild size="sm">
              <a href={sandbox.codeServerUrl} target="_blank" rel="noreferrer">
                {t.codeboxOpen}
                <RiArrowRightUpLine />
              </a>
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "pause")}
              disabled={busyAction === `pause:${sandbox.sandboxId}`}
              aria-label={t.codeboxPauseSandbox}
            >
              {busyAction === `pause:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiPauseLine />
              )}
            </Button>
          ) : null}
          {isPaused ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "resume")}
              disabled={busyAction === `resume:${sandbox.sandboxId}`}
              aria-label={t.codeboxResumeSandbox}
            >
              {busyAction === `resume:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiRestartLine />
              )}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="icon-sm"
            onClick={() => void onAction(sandbox, "kill")}
            disabled={busyAction === `kill:${sandbox.sandboxId}`}
            aria-label={t.codeboxKillSandbox}
          >
            {busyAction === `kill:${sandbox.sandboxId}` ? (
              <RiLoader4Line className="animate-spin" />
            ) : (
              <RiDeleteBin6Line />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <CopyLine
          label={t.codeboxUrl}
          value={sandbox.codeServerUrl ?? "-"}
          onCopy={() => onCopy(sandbox.codeServerUrl)}
        />
        <CopyLine
          label={t.codeboxPassword}
          value={sandbox.password ?? "-"}
          onCopy={() => onCopy(sandbox.password)}
        />
        <InfoLine label={t.codeboxWorkspace} value={sandbox.workspacePath} />
        <InfoLine label={t.codeboxRepo} value={sandbox.repoUrl ?? "-"} />
      </div>
    </article>
  )
}

function CopyLine({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => Promise<boolean>
}) {
  const [copied, setCopied] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => setCopied(false), 1200)

    return () => window.clearTimeout(timeout)
  }, [copied])

  async function handleCopy() {
    setCopied(await onCopy())
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void handleCopy()}
        disabled={value === "-"}
        aria-label={t.codeboxCopyLabel(label)}
      >
        {copied ? <RiCheckLine /> : <RiFileCopyLine />}
      </Button>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
    </div>
  )
}

function LoadingBlock() {
  const { t } = useI18n()

  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background text-sm text-muted-foreground">
      <RiLoader4Line className="mr-2 size-4 animate-spin" aria-hidden />
      {t.codeboxLoading}
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background px-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function GithubDeviceDialog({
  open,
  onOpenChange,
  flow,
  message,
  onCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flow: GithubDeviceFlow | null
  message: string
  onCopy: (value: string | null | undefined) => Promise<boolean>
}) {
  const { locale, t } = useI18n()
  const [copyState, setCopyState] = React.useState<{
    userCode: string | null
    status: "idle" | "copied" | "blocked"
  }>({
    userCode: null,
    status: "idle",
  })
  const activeCopyStatus =
    open && copyState.userCode === flow?.userCode ? copyState.status : "idle"

  async function handleCopyCode() {
    if (!flow?.userCode) {
      return
    }

    setCopyState({
      userCode: flow.userCode,
      status: (await onCopy(flow.userCode)) ? "copied" : "blocked",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.codeboxConnectGithubTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxConnectGithubDescription}
          </DialogDescription>
        </DialogHeader>

        {flow ? (
          <div className="grid gap-3">
            <div className="rounded-2xl border bg-background p-4 text-center">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                {t.codeboxDeviceCode}
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-normal">
                {flow.userCode}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void handleCopyCode()}
              >
                {activeCopyStatus === "copied" ? (
                  <RiCheckLine />
                ) : (
                  <RiFileCopyLine />
                )}
                {activeCopyStatus === "copied" ? t.copied : t.codeboxCopyCode}
              </Button>
              {activeCopyStatus === "blocked" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.codeboxCopyBlocked}
                </p>
              ) : null}
            </div>

            <Button asChild>
              <a href={flow.verificationUri} target="_blank" rel="noreferrer">
                {t.codeboxOpenGithub}
                <RiArrowRightUpLine />
              </a>
            </Button>

            <p className="text-sm text-muted-foreground">
              {message ||
                t.codeboxExpiresAt(formatDate(flow.expiresAt, locale))}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {message || t.codeboxNoActiveGithubFlow}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConfirmActionDialog({
  action,
  onOpenChange,
  onConfirm,
}: {
  action: ConfirmAction | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const isVolume = action?.kind === "volume"
  const target =
    action?.kind === "volume"
      ? action.volume.name
      : (action?.sandbox.volumeName ?? action?.sandbox.sandboxId ?? "")

  return (
    <Dialog open={Boolean(action)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <RiDeleteBin6Line className="size-5" aria-hidden />
          </div>
          <DialogTitle>
            {isVolume ? t.codeboxDeleteVolumeTitle : t.codeboxKillSandboxTitle}
          </DialogTitle>
          <DialogDescription>
            {isVolume
              ? t.codeboxDeleteVolumeConfirm(target)
              : t.codeboxKillSandboxConfirm(target)}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.codeboxCancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <RiDeleteBin6Line />
            {isVolume ? t.codeboxDelete : t.codeboxKill}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CodeBoxPage }
