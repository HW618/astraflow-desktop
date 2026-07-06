import type { StructuredToolInterface } from "@langchain/core/tools"

import { getStudioModelverseApiKey } from "@/lib/studio-db"
import {
  createExaWebSearchTool,
  createWebFetchTool,
  getStoredExaApiKey,
} from "@/lib/ai/tools/web"
import { createListInstalledMcpServersTool } from "@/lib/ai/tools/mcp"
import {
  createGetStudioMediaModelSchemaTool,
  createGetStudioMediaGenerationTool,
  createListStudioMediaGenerationModelsTool,
  createListStudioMediaGenerationsTool,
  createStudioGenerateImageTool,
  createStudioGenerateVideoTool,
} from "@/lib/ai/tools/media-generation"
import {
  createCodeInterpreterTool,
  createDownloadFileTool,
  createListFilesTool,
  createReadFileTool,
  createRunCommandTool,
  createSandboxGetHostTool,
  createSandboxStartServiceTool,
  createSessionSandboxGetter,
  createUploadFileTool,
  createWriteFileTool,
} from "@/lib/ai/tools/astraflow-sandbox"

type StudioAgentToolsOptions = {
  sessionId?: string
  modelverseApiKey?: string | null
}

export function createStudioAgentTools(options: StudioAgentToolsOptions = {}) {
  const exaApiKey = getStoredExaApiKey()
  const modelverseApiKey =
    options.modelverseApiKey ?? getStudioModelverseApiKey()?.key
  const tools: StructuredToolInterface[] = [
    createWebFetchTool(),
    createListInstalledMcpServersTool(),
  ]

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  if (modelverseApiKey && options.sessionId) {
    const getSandboxContext = createSessionSandboxGetter({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
    })

    tools.push(
      createListStudioMediaGenerationModelsTool(),
      createGetStudioMediaModelSchemaTool(),
      createListStudioMediaGenerationsTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createGetStudioMediaGenerationTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createStudioGenerateImageTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createStudioGenerateVideoTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createUploadFileTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createCodeInterpreterTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createRunCommandTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createSandboxGetHostTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createSandboxStartServiceTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createListFilesTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createReadFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createWriteFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createDownloadFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
      })
    )
  }

  return tools
}
