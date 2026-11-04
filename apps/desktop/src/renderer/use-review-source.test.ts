import { describe, expect, it, vi } from "vitest"

vi.mock("./rpc-client.js", () => ({ rpc: {} }))
import { availableReviewSource } from "./use-review.js"

describe("availableReviewSource", () => {
  it("keeps an empty local source local even when the PR has files", () => {
    expect(availableReviewSource("local", true, false)).toBe("local")
  })
  it("falls back from an empty PR source to local changes", () => {
    expect(availableReviewSource("pr", false, true)).toBe("local")
  })
})
