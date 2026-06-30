import type { StructuredToolInterface } from "@langchain/core/tools"

import { getStudioModelverseApiKey } from "@/lib/studio-db"
import {
  createExaWebSearchTool,
  createWebFetchTool,
  getStoredExaApiKey,
} from "@/lib/ai/tools/web"
import {
  createCodeInterpreterTool,
  createDownloadFileTool,
  createListFilesTool,
  createReadFileTool,
  createRunCommandTool,
  createSandboxGetHostTool,
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
  const tools: StructuredToolInterface[] = [createWebFetchTool()]

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  if (modelverseApiKey && options.sessionId) {
    const getSandboxContext = createSessionSandboxGetter({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
    })

    tools.push(
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
