import { describe, expect, it } from "vitest"
import { githubPollInterval, rateLimitWaitMs, retryUnlessRateLimited } from "./github-poll.js"

const limited = (retryAt?: string) => ({ reason: "rate-limited", ...(retryAt ? { retryAt } : {}) })

describe("github polling", () => {
  it("waits until retryAt after a rate limit", () => {
    const now = Date.parse("2026-11-02T10:00:00Z")
    expect(rateLimitWaitMs(limited("2026-11-02T10:05:00Z"), now)).toBe(300_000)
    expect(rateLimitWaitMs(limited(), now)).toBe(60_000)
    expect(rateLimitWaitMs({ reason: "unavailable" }, now)).toBeNull()
  })

  it("keeps the base interval when not limited and stretches it when limited", () => {
    const poll = githubPollInterval(10_000)
    expect(poll({ state: { error: null } })).toBe(10_000)
    expect(poll({ state: { error: limited(new Date(Date.now() + 120_000).toISOString()) } })).toBeGreaterThan(100_000)
  })

  it("never retries a rate-limited read", () => {
    expect(retryUnlessRateLimited(0, limited())).toBe(false)
    expect(retryUnlessRateLimited(0, { reason: "unavailable" })).toBe(true)
    expect(retryUnlessRateLimited(3, { reason: "unavailable" })).toBe(false)
  })
})
