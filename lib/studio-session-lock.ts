const sessionLocks = new Map<string, Promise<void>>()

export async function withStudioSessionLock<T>(
  sessionId: string,
  task: () => Promise<T>
) {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => current, () => current)

  sessionLocks.set(sessionId, chained)

  try {
    await previous.catch(() => undefined)
    return await task()
  } finally {
    release()

    if (sessionLocks.get(sessionId) === chained) {
      sessionLocks.delete(sessionId)
    }
  }
}
