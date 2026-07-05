import assert from "node:assert/strict"

import {
  codexDirectNotificationAgentEvents,
  codexDirectTurnAgentEvents,
} from "./codex-direct/mapper-fixture"
import { evaluateClaudeNativeMapperFixture } from "./claude-native/mapper-fixture"
import expectedOpenCodeEvents from "./opencode-native/expected-agent-events.json"
import openCodeEvents from "./opencode-native/events.json"
import { mapOpenCodeNativeEvents } from "@/lib/agent/adapters/opencode-native-runtime"

assert.ok(codexDirectNotificationAgentEvents.length > 0)
assert.ok(codexDirectTurnAgentEvents.length > 0)

const claudeFixture = evaluateClaudeNativeMapperFixture()
assert.deepEqual(claudeFixture.actual, claudeFixture.expected)

assert.deepEqual(
  mapOpenCodeNativeEvents(openCodeEvents, { sessionId: "ses_root" }),
  expectedOpenCodeEvents
)
