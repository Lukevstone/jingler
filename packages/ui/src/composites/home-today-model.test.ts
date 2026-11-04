import { describe, expect, it } from "vitest"
import type { HomePullRequest } from "@jingler/core"
import { closedSince, ensurePick, localDate, parsePick, pickReviews, reviewDone, todoReviews } from "./home-today-model.js"

const pr = (id: string, over: Partial<HomePullRequest> = {}): HomePullRequest => ({
  id, number: 1, title: id, url: "", repository: "acme/widget", author: "jo",
  state: "open", checks: null, reviewDecision: null,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  viewerReviewedAt: null, directRequest: false, ...over
})

const now = new Date(2026, 10, 4, 9, 0)

describe("pickReviews", () => {
  it("takes direct requests first, then oldest, capped at 3", () => {
    const pool = [
      pr("PR_team_old", { createdAt: "2026-10-01T00:00:00Z" }),
      pr("PR_direct_new", { createdAt: "2026-11-03T00:00:00Z", directRequest: true }),
      pr("PR_team_mid", { createdAt: "2026-10-15T00:00:00Z" }),
      pr("PR_team_new", { createdAt: "2026-11-02T00:00:00Z" })
    ]
    expect(pickReviews(pool)).toEqual(["PR_direct_new", "PR_team_old", "PR_team_mid"])
  })
})

describe("ensurePick", () => {
  it("keeps today's pick for the same account, even when the pool changes", () => {
    const stored = { date: localDate(now), account: "me", pickedAt: "x", ids: ["PR_a"] }
    expect(ensurePick(stored, "me", [pr("PR_b")], now)).toBe(stored)
  })

  it("re-picks on a new day or another account", () => {
    const stale = { date: "2026-11-03", account: "me", pickedAt: "x", ids: ["PR_a"] }
    expect(ensurePick(stale, "me", [pr("PR_b")], now).ids).toEqual(["PR_b"])
    const other = { ...stale, date: localDate(now) }
    expect(ensurePick(other, "you", [pr("PR_b")], now).ids).toEqual(["PR_b"])
  })

  it("an empty pool freezes an empty pick", () => {
    expect(ensurePick(null, "me", [], now).ids).toEqual([])
  })
})

describe("reviewDone", () => {
  const pickedAt = "2026-11-04T08:00:00Z"
  it("counts a review after the pick, merged, closed or a vanished PR", () => {
    expect(reviewDone(pr("a", { viewerReviewedAt: "2026-11-04T08:30:00Z" }), pickedAt)).toBe(true)
    expect(reviewDone(pr("a", { state: "merged" }), pickedAt)).toBe(true)
    expect(reviewDone(pr("a", { state: "closed" }), pickedAt)).toBe(true)
    expect(reviewDone(null, pickedAt)).toBe(true)
  })

  it("ignores a review from before the pick", () => {
    expect(reviewDone(pr("a", { viewerReviewedAt: "2026-11-03T08:30:00Z" }), pickedAt)).toBe(false)
  })
})

describe("todoReviews", () => {
  const pick = { date: localDate(now), account: "me", pickedAt: "2026-11-04T08:00:00Z", ids: ["PR_a", "PR_b"] }

  it("uses the node read, so a PR that left the search still resolves as done", () => {
    const rows = todoReviews(pick, [pr("PR_a", { state: "merged" }), pr("PR_b")], [])
    expect(rows.map((row) => row.done)).toEqual([true, false])
  })

  it("falls back to the pool before the node read loads", () => {
    const rows = todoReviews(pick, undefined, [pr("PR_b")])
    expect(rows.map((row) => [row.pr?.id ?? null, row.done])).toEqual([[null, false], ["PR_b", false]])
  })
})

it("closedSince is 7 days back as a local date", () => {
  expect(closedSince(now)).toBe("2026-10-28")
})

describe("parsePick", () => {
  const good = { date: "2026-11-04", account: "me", pickedAt: "2026-11-04T09:00:00.000Z", ids: ["PR_a", "MDExOlB1bGxSZXF1ZXN0MQ=="] }
  it("keeps a valid record, legacy node ids included", () => {
    expect(parsePick(good)).toEqual(good)
  })
  it("drops records that would block Home reads", () => {
    for (const bad of [null, "x", { ...good, pickedAt: undefined }, { ...good, pickedAt: "soon" }, { ...good, ids: ["a", "b", "c", "d"] },
      { ...good, ids: ["bad id"] }, { ...good, account: "" }, { ...good, date: "today" }]) expect(parsePick(bad)).toBeNull()
  })
})
