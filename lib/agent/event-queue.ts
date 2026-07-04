import type { AgentEvent } from "@/lib/agent/events"

type AgentEventQueueState =
  | { status: "open" }
  | { status: "closed" }
  | { status: "failed"; error: unknown }

export class AgentEventQueue implements AsyncIterable<AgentEvent> {
  private events: AgentEvent[] = []
  private state: AgentEventQueueState = { status: "open" }
  private waiters: Array<() => void> = []

  push(event: AgentEvent) {
    if (this.state.status !== "open") {
      return
    }

    this.events.push(event)
    this.notify()
  }

  close() {
    if (this.state.status !== "open") {
      return
    }

    this.state = { status: "closed" }
    this.notify()
  }

  fail(error: unknown) {
    if (this.state.status !== "open") {
      return
    }

    this.state = { status: "failed", error }
    this.notify()
  }

  private notify() {
    const waiters = this.waiters
    this.waiters = []

    for (const waiter of waiters) {
      waiter()
    }
  }

  private wait() {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const event = this.events.shift()

      if (event) {
        yield event
        continue
      }

      if (this.state.status === "closed") {
        return
      }

      if (this.state.status === "failed") {
        throw this.state.error
      }

      await this.wait()
    }
  }
}
