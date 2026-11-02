import { describe, expect, it } from "vitest"
import { cdpKeyEvents } from "./browser-page-scripts.js"
import { createBrowserRecorder, MAX_ENTRY_CHARS, MAX_NETWORK_ENTRIES } from "./browser-recorder.js"

const request = (requestId: string, url: string, timestamp = 1, extra: object = {}) => [
  "Network.requestWillBeSent",
  { requestId, timestamp, type: "Fetch", request: { url, method: "GET", headers: {} }, ...extra }
] as const

const response = (requestId: string, status: number, mimeType = "application/json") => [
  "Network.responseReceived",
  { requestId, type: "Fetch", response: { status, statusText: "", headers: { a: "b" }, mimeType } }
] as const

describe("createBrowserRecorder network", () => {
  it("builds one entry per request with status, duration and failure", () => {
    const r = createBrowserRecorder(async () => ({}))
    r.handle(...request("1", "http://x/api/ok", 1))
    r.handle(...response("1", 200))
    r.handle("Network.loadingFinished", { requestId: "1", timestamp: 1.25, encodedDataLength: 42 })
    r.handle(...request("2", "http://x/api/boom", 2))
    r.handle("Network.loadingFailed", { requestId: "2", timestamp: 2.1, errorText: "net::ERR_CONNECTION_REFUSED" })
    r.handle(...request("3", "http://x/api/missing", 3))
    r.handle(...response("3", 404))

    const all = r.networkRequests({})
    expect(all.map((e) => [e.id, e.status, e.failure])).toStrictEqual([
      ["1", 200, null],
      ["2", null, "net::ERR_CONNECTION_REFUSED"],
      ["3", 404, null]
    ])
    expect(all[0]).toMatchObject({ durationMs: 250, encodedBytes: 42, responseHeaders: { a: "b" } })
    expect(r.networkRequests({ onlyFailed: true }).map((e) => e.id)).toStrictEqual(["2", "3"])
    expect(r.networkRequests({ urlContains: "ok" }).map((e) => e.id)).toStrictEqual(["1"])
    expect(r.networkRequests({ limit: 1 }).map((e) => e.id)).toStrictEqual(["3"])
  })

  it("keeps each redirect hop and clears on request", () => {
    const r = createBrowserRecorder(async () => ({}))
    r.handle(...request("1", "http://x/old"))
    r.handle(...request("1", "http://x/new", 2, {
      redirectResponse: { status: 302, statusText: "Found", headers: {}, mimeType: "" }
    }))
    expect(r.networkRequests({ clear: true }).map((e) => [e.url, e.status])).toStrictEqual([
      ["http://x/old", 302],
      ["http://x/new", null]
    ])
    expect(r.networkRequests({})).toStrictEqual([])
  })

  it("evicts the oldest request past the cap", () => {
    const r = createBrowserRecorder(async () => ({}))
    for (let i = 0; i <= MAX_NETWORK_ENTRIES; i++) r.handle(...request(String(i), `http://x/${i}`))
    const all = r.networkRequests({ limit: 1_000 })
    expect(all).toHaveLength(MAX_NETWORK_ENTRIES)
    expect(all[0]?.id).toBe("1")
  })

  it("fetches text bodies, summarises binary ones, and rejects unknown ids", async () => {
    const r = createBrowserRecorder(async (_m, params) =>
      (params as { requestId: string }).requestId === "1"
        ? { body: Buffer.from('{"ok":true}').toString("base64"), base64Encoded: true }
        : { body: "AAAA", base64Encoded: true })
    r.handle(...request("1", "http://x/json"))
    r.handle(...response("1", 200))
    r.handle(...request("2", "http://x/img"))
    r.handle(...response("2", 200, "image/png"))
    expect((await r.networkRequestDetail("1")).body).toBe('{"ok":true}')
    expect((await r.networkRequestDetail("2")).body).toBe("(binary image/png, 3 bytes)")
    await expect(r.networkRequestDetail("nope")).rejects.toThrow("No recorded request")
  })
})

describe("createBrowserRecorder bounds and wire headers", () => {
  it("truncates oversized post data and console text", () => {
    const r = createBrowserRecorder(async () => ({}))
    const huge = "x".repeat(MAX_ENTRY_CHARS * 5)
    r.handle("Network.requestWillBeSent", {
      requestId: "1", timestamp: 1, type: "Fetch",
      request: { url: "http://x/post", method: "POST", headers: {}, postData: huge }
    })
    r.handle("Runtime.consoleAPICalled", { type: "log", timestamp: 1, args: [{ value: huge }] })
    const post = r.networkRequests({})[0]?.postData ?? ""
    const text = r.consoleLogs({})[0]?.text ?? ""
    for (const value of [post, text]) {
      expect(value.length).toBeLessThan(MAX_ENTRY_CHARS + 100)
      expect(value).toContain(`truncated, ${huge.length} chars`)
    }
  })

  it("merges ExtraInfo cookie headers per redirect hop, whichever arrives first", () => {
    const r = createBrowserRecorder(async () => ({}))
    // ExtraInfo for hop 0 arrives before its request; hop 1's after.
    r.handle("Network.requestWillBeSentExtraInfo", { requestId: "1", headers: { Cookie: "sid=old" } })
    r.handle(...request("1", "http://x/login"))
    r.handle("Network.responseReceivedExtraInfo", { requestId: "1", headers: { "Set-Cookie": "sid=new" } })
    r.handle(...request("1", "http://x/home", 2, {
      redirectResponse: { status: 302, statusText: "Found", headers: {}, mimeType: "" }
    }))
    r.handle("Network.requestWillBeSentExtraInfo", { requestId: "1", headers: { Cookie: "sid=new" } })
    const [hop0, hop1] = r.networkRequests({})
    expect(hop0).toMatchObject({ requestHeaders: { Cookie: "sid=old" }, responseHeaders: { "Set-Cookie": "sid=new" } })
    expect(hop1?.requestHeaders).toStrictEqual({ Cookie: "sid=new" })
  })
})

describe("createBrowserRecorder console", () => {
  it("records console calls, exceptions and log entries with filtering", () => {
    const r = createBrowserRecorder(async () => ({}))
    r.handle("Runtime.consoleAPICalled", {
      type: "warning",
      timestamp: 1,
      args: [{ value: "careful" }, { value: { n: 1 } }]
    })
    r.handle("Runtime.exceptionThrown", {
      timestamp: 2,
      exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: x is undefined" } }
    })
    r.handle("Log.entryAdded", {
      entry: { source: "network", level: "error", text: "Failed to load resource", timestamp: 3 }
    })
    expect(r.consoleLogs({}).map((e) => [e.level, e.source, e.text])).toStrictEqual([
      ["warn", "console", 'careful {"n":1}'],
      ["error", "exception", "TypeError: x is undefined"],
      ["error", "network", "Failed to load resource"]
    ])
    expect(r.consoleLogs({ level: "error", textContains: "TypeError" })).toHaveLength(1)
    r.consoleLogs({ clear: true })
    expect(r.consoleLogs({})).toStrictEqual([])
  })
})

describe("cdpKeyEvents", () => {
  it("sends text-producing keys as keyDown with text, others as rawKeyDown", () => {
    expect(cdpKeyEvents("Enter")[0]).toMatchObject({ type: "keyDown", key: "Enter", text: "\r", windowsVirtualKeyCode: 13 })
    expect(cdpKeyEvents("Escape")[0]).toMatchObject({ type: "rawKeyDown", key: "Escape" })
    expect(cdpKeyEvents("a")[0]).toMatchObject({ type: "keyDown", key: "a", code: "KeyA", text: "a" })
    expect(cdpKeyEvents(" ")[0]).toMatchObject({ key: " ", code: "Space", text: " " })
    expect(cdpKeyEvents("Tab").map((e) => e.type)).toStrictEqual(["rawKeyDown", "keyUp"])
  })

  it("rejects unknown multi-character keys", () => {
    expect(() => cdpKeyEvents("Hyper")).toThrow("Unsupported key")
  })
})
