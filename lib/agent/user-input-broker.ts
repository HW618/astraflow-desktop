import {
  type AgentUserInputAnswer,
  type AgentUserInputQuestion,
} from "@/lib/agent/events"

export type UserInputDecision =
  | { answers: AgentUserInputAnswer[] }
  | { cancelled: true }

type PendingUserInput = {
  answersOnTimeout: AgentUserInputAnswer[] | null
  questions: AgentUserInputQuestion[]
  resolve: (decision: UserInputDecision) => void
  sessionId: string
}

const USER_INPUT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

const pendingUserInputs = new Map<string, PendingUserInput>()

function getPendingKey(sessionId: string, requestId: string) {
  return `${sessionId}:${requestId}`
}

function createDefaultAnswers(questions: AgentUserInputQuestion[]) {
  const answers: AgentUserInputAnswer[] = []

  for (const question of questions) {
    const option = question.options[0] ?? null

    if (!option) {
      return null
    }

    answers.push({
      questionId: question.id,
      optionId: option.optionId,
      label: option.label,
      text: option.label,
    })
  }

  return answers
}

function normalizeAnswer(
  answer: AgentUserInputAnswer,
  question: AgentUserInputQuestion
): AgentUserInputAnswer | null {
  const text = answer.text.trim()
  const option =
    answer.optionId === null
      ? null
      : question.options.find(
          (candidate) => candidate.optionId === answer.optionId
        ) ?? null

  if (!option && !question.allowOther) {
    return null
  }

  if (!option && !text) {
    return null
  }

  return {
    questionId: question.id,
    optionId: option?.optionId ?? null,
    label: option?.label ?? null,
    text: text || option?.label || "",
  }
}

export function requestUserInput(input: {
  autoResolutionMs?: number | null
  questions: AgentUserInputQuestion[]
  requestId: string
  sessionId: string
  signal: AbortSignal
}): Promise<UserInputDecision> {
  if (input.questions.length === 0 || input.signal.aborted) {
    return Promise.resolve({ cancelled: true })
  }

  const key = getPendingKey(input.sessionId, input.requestId)
  const existing = pendingUserInputs.get(key)

  if (existing) {
    existing.resolve({ cancelled: true })
  }

  const hasAutoResolution =
    typeof input.autoResolutionMs === "number" && input.autoResolutionMs > 0
  const answersOnTimeout = hasAutoResolution
    ? createDefaultAnswers(input.questions)
    : null
  const timeoutMs = hasAutoResolution
    ? Math.min(Math.max(input.autoResolutionMs ?? 0, 1_000), 10 * 60 * 1000)
    : USER_INPUT_REQUEST_TIMEOUT_MS

  return new Promise<UserInputDecision>((resolve) => {
    let timeout: NodeJS.Timeout | null = null
    const settle = (decision: UserInputDecision) => {
      if (pendingUserInputs.get(key)?.resolve !== settle) {
        return
      }

      pendingUserInputs.delete(key)
      if (timeout) {
        clearTimeout(timeout)
      }
      input.signal.removeEventListener("abort", abort)
      resolve(decision)
    }
    const abort = () => settle({ cancelled: true })

    timeout = setTimeout(
      () =>
        settle(
          answersOnTimeout !== null
            ? { answers: answersOnTimeout }
            : { cancelled: true }
        ),
      timeoutMs
    )
    timeout.unref()

    pendingUserInputs.set(key, {
      answersOnTimeout,
      questions: input.questions,
      resolve: settle,
      sessionId: input.sessionId,
    })
    input.signal.addEventListener("abort", abort, { once: true })
  })
}

export function resolveUserInput(
  sessionId: string,
  requestId: string,
  answers: AgentUserInputAnswer[],
  cancelled = false
) {
  const key = getPendingKey(sessionId, requestId)
  const pending = pendingUserInputs.get(key)

  if (!pending) {
    return false
  }

  if (cancelled) {
    pending.resolve({ cancelled: true })
    return true
  }

  const normalizedAnswers = pending.questions
    .map((question) => {
      const answer = answers.find(
        (candidate) => candidate.questionId === question.id
      )

      return answer ? normalizeAnswer(answer, question) : null
    })
    .filter((answer): answer is AgentUserInputAnswer => Boolean(answer))

  if (normalizedAnswers.length !== pending.questions.length) {
    return false
  }

  pending.resolve({ answers: normalizedAnswers })
  return true
}

export function cancelSessionUserInputs(sessionId: string) {
  let cancelled = 0
  const prefix = `${sessionId}:`

  for (const [key, pending] of pendingUserInputs) {
    if (!key.startsWith(prefix)) {
      continue
    }

    pending.resolve({ cancelled: true })
    cancelled += 1
  }

  return cancelled
}
