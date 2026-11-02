import { GitHubApiError } from "@jingler/core"
import { describe, expect, it } from "vitest"
import { MAX_IN_FLIGHT, MUTATION_SPACING_MS, makeRateGate } from "./github-rate-gate.js"

const fakeClock = () => {
  let now = 1_000_000
  const slept: number[] = []
  return {
    clock: { now: () => now, sleep: async (ms: number) => { slept.push(ms); now += ms } },
    advance: (ms: number) => { now += ms },
    slept
  }
}

const rateLimited = (fn: () => void): GitHubApiError => {
  try {
    fn()
  } catch (error) {
    if (error instanceof GitHubApiError) return error
  }
  throw new Error("expected a rate-limited error")
}

describe("makeRateGate", () => {
  it("blocks a key until retryAt, then lets it through", () => {
    const { clock, advance } = fakeClock()
    const gate = makeRateGate(clock)
    gate.trip("inst", new Date(clock.now() + 30_000).toISOString())
    const error = rateLimited(() => gate.check("inst"))
    expect(error.reason).toBe("rate-limited")
    expect(error.retryAt).toBe(new Date(clock.now() + 30_000).toISOString())
    expect(() => gate.check("other")).not.toThrow()
    advance(30_000)
    expect(() => gate.check("inst")).not.toThrow()
  })

  it("falls back to 60s, doubling on repeat hits", () => {
    const { clock } = fakeClock()
    const gate = makeRateGate(clock)
    gate.trip("inst")
    expect(Date.parse(rateLimited(() => gate.check("inst")).retryAt!)).toBe(clock.now() + 60_000)
    gate.trip("inst")
    expect(Date.parse(rateLimited(() => gate.check("inst")).retryAt!)).toBe(clock.now() + 120_000)
    gate.clear("inst")
    expect(() => gate.check("inst")).not.toThrow()
  })

  it("caps concurrent requests", async () => {
    const gate = makeRateGate(fakeClock().clock)
    let running = 0
    let peak = 0
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
    const tasks = Array.from({ length: MAX_IN_FLIGHT + 3 }, () =>
      gate.run(false, async () => {
        running++
        peak = Math.max(peak, running)
        await tick()
        running--
      }))
    await Promise.all(tasks)
    expect(peak).toBe(MAX_IN_FLIGHT)
  })

  it("spaces mutations at least 1s apart but not reads", async () => {
    const { clock, slept } = fakeClock()
    const gate = makeRateGate(clock)
    await gate.run(true, async () => {})
    await gate.run(true, async () => {})
    await gate.run(false, async () => {})
    expect(slept).toEqual([MUTATION_SPACING_MS])
  })
})
