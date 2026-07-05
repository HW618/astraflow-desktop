import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  evaluateAcpMapperFixture,
  evaluateAcpRuntimeInfoFixture,
} from "./acp/mapper-fixture"
import {
  codexDirectNotificationAgentEvents,
  codexDirectTurnAgentEvents,
  evaluateCodexDirectMapperFixture,
} from "./codex-direct/mapper-fixture"
import { evaluateClaudeNativeMapperFixture } from "./claude-native/mapper-fixture"
import { evaluateDeepAgentsMapperFixture } from "./deepagents/mapper-fixture"
import { agentRuntimeVersionCompatibilityMatrix } from "./version-compatibility-matrix"
import expectedOpenCodeEvents from "./opencode-native/expected-agent-events.json"
import openCodeEvents from "./opencode-native/events.json"
import { mapOpenCodeNativeEvents } from "@/lib/agent/adapters/opencode-native-runtime"
import { AGENT_RUNTIME_PROVIDER_METADATA } from "@/lib/agent/provider-metadata"

assert.ok(codexDirectNotificationAgentEvents.length > 0)
assert.ok(codexDirectTurnAgentEvents.length > 0)

const codexDirectFixture = evaluateCodexDirectMapperFixture()
assert.deepEqual(codexDirectFixture.actual, codexDirectFixture.expected)

const claudeFixture = evaluateClaudeNativeMapperFixture()
assert.deepEqual(claudeFixture.actual, claudeFixture.expected)

const acpFixture = evaluateAcpMapperFixture()
assert.deepEqual(acpFixture.actual, acpFixture.expected)

const acpRuntimeInfoFixture = evaluateAcpRuntimeInfoFixture()
assert.deepEqual(
  acpRuntimeInfoFixture.actual,
  acpRuntimeInfoFixture.expected
)

const deepAgentsFixture = evaluateDeepAgentsMapperFixture()
assert.deepEqual(deepAgentsFixture.actual, deepAgentsFixture.expected)

assert.deepEqual(
  mapOpenCodeNativeEvents(openCodeEvents, { sessionId: "ses_root" }),
  expectedOpenCodeEvents
)

const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const declaredDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}

for (const entry of agentRuntimeVersionCompatibilityMatrix) {
  assert.equal(
    declaredDependencies[entry.packageName],
    entry.version,
    `${entry.packageName} must stay pinned for ${entry.coverage}`
  )

  if (entry.packageName !== "@agentclientprotocol/sdk") {
    assert.ok(
      Object.values(AGENT_RUNTIME_PROVIDER_METADATA).some(
        (metadata) =>
          metadata.packageName === entry.packageName &&
          metadata.packageVersion === entry.version
      ),
      `${entry.packageName} must be represented in provider metadata`
    )
  }
}
