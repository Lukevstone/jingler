import { GitHubApiError } from "@jingler/core"

/**
 * Client-side compliance with GitHub's rate-limit guidance
 * (docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api):
 * stop calling while limited, cap concurrency, and space out mutations.
 */
const FALLBACK_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 15 * 60_000
export const MAX_IN_FLIGHT = 4
export const MUTATION_SPACING_MS = 1_000

export interface RateGateClock {
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const realClock: RateGateClock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

export const makeRateGate = (clock: RateGateClock = realClock) => {
  const cooldowns = new Map<string, { until: number; strikes: number }>()
  let inFlight = 0
  const waiting: Array<() => void> = []
  let nextMutationAt = 0

  /** Throws the same `rate-limited` error GitHub would, without sending anything. */
  const check = (key: string): void => {
    const cooldown = cooldowns.get(key)
    if (!cooldown || cooldown.until <= clock.now()) return
    const retryAt = new Date(cooldown.until).toISOString()
    throw new GitHubApiError({
      reason: "rate-limited",
      message: `GitHub's rate limit was reached. Retry after ${retryAt}.`,
      retryAt
    })
  }

  /** Cool `key` down until `retryAt`, else 60s doubling per repeat hit (capped at 15 min). */
  const trip = (key: string, retryAt?: string): void => {
    const strikes = (cooldowns.get(key)?.strikes ?? 0) + 1
    const parsed = retryAt === undefined ? Number.NaN : Date.parse(retryAt)
    const until = Number.isFinite(parsed)
      ? parsed
      : clock.now() + Math.min(FALLBACK_COOLDOWN_MS * 2 ** (strikes - 1), MAX_COOLDOWN_MS)
    cooldowns.set(key, { until, strikes })
  }

  const clear = (key: string): void => {
    cooldowns.delete(key)
  }

  /** Run `task` with at most MAX_IN_FLIGHT running and mutations ≥1s apart. */
  const run = async <A>(mutation: boolean, task: () => Promise<A>): Promise<A> => {
    while (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve))
    inFlight++
    try {
      if (mutation) {
        const wait = nextMutationAt - clock.now()
        nextMutationAt = Math.max(clock.now(), nextMutationAt) + MUTATION_SPACING_MS
        if (wait > 0) await clock.sleep(wait)
      }
      return await task()
    } finally {
      inFlight--
      waiting.shift()?.()
    }
  }

  return { check, trip, clear, run }
}

export type RateGate = ReturnType<typeof makeRateGate>
