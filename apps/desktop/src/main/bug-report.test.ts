import type { Message } from "@jingler/core"
import { describe, expect, it, vi } from "vitest"
import { submitBugReport, transcriptMarkdown } from "./bug-report.js"

const message = (role: Message["role"], parts: Message["parts"]): Message => ({
  id: "m",
  role,
  parts,
  streaming: false,
  createdAt: "2026-01-01T00:00:00Z"
})

describe("bug report", () => {
  it("renders only text turns", () => {
    const md = transcriptMarkdown([
      message("user", [{ _tag: "Text", text: "hi" }]),
      message("assistant", [{ _tag: "Text", text: "   " }])
    ])
    expect(md).toBe("### user\n\nhi")
  })

  it("posts to the server and surfaces its error", async () => {
    const ok = vi.fn(async () => Response.json({ url: "https://x/1" }, { status: 201 }))
    expect(await submitBugReport({ title: "t", description: "", appVersion: "1", messages: [], screenshots: [] }, ok as unknown as typeof fetch)).toEqual({ url: "https://x/1" })
    const bad = vi.fn(async () => Response.json({ error: "nope" }, { status: 503 }))
    await expect(submitBugReport({ title: "t", description: "", appVersion: "1", messages: [], screenshots: [] }, bad as unknown as typeof fetch)).rejects.toThrow("nope")
  })
})
