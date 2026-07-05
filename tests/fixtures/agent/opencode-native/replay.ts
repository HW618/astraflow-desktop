import assert from "node:assert/strict"

import { mapOpenCodeNativeEvents } from "../../../../lib/agent/adapters/opencode-native-runtime"
import expected from "./expected-agent-events.json"
import events from "./events.json"

const actual = mapOpenCodeNativeEvents(events, { sessionId: "ses_root" })

assert.deepEqual(actual, expected)
