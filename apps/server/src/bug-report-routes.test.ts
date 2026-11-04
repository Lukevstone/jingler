import { describe, expect, it, vi } from "vitest"
import { createBugReportRoutes, type BugReportConfig } from "./bug-report-routes.js"

const config: BugReportConfig = {
  githubToken: "gh-token",
  githubRepo: "acme/jingler",
  r2Endpoint: "https://r2.test",
  r2Bucket: "bucket",
  r2AccessKeyId: "key",
  r2SecretAccessKey: "secret",
  r2PublicUrl: "https://files.test"
}

const memoryHit = () => {
  const counts = new Map<string, number>()
  return async (key: string, window: number) => {
    const k = `${key}:${window}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
    return counts.get(k) ?? 0
  }
}
const make = (overrides: Parameters<typeof createBugReportRoutes>[0] = {}) =>
  createBugReportRoutes({ config: () => config, hit: memoryHit(), ...overrides })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("png-bytes")]).toString("base64")
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("jpg-bytes")]).toString("base64")

const post = (routes: ReturnType<typeof createBugReportRoutes>, body: unknown, ip = "1.1.1.1") =>
  routes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body)
  })

const valid = {
  title: "It broke",
  description: "Steps",
  transcript: "# chat",
  screenshots: [{ type: "image/png", base64: PNG }]
}

describe("bug report routes", () => {
  it("returns 503 when not configured", async () => {
    const routes = make({ config: () => ({ ...config, githubToken: "" }) })
    expect((await post(routes, valid)).status).toBe(503)
  })

  it("rejects invalid bodies", async () => {
    const routes = make()
    expect((await post(routes, { title: "" , description: "", screenshots: [] })).status).toBe(400)
  })

  it("uploads attachments to R2 and files the issue with their links", async () => {
    const issue = vi.fn(async () =>
      Response.json({ html_url: "https://github.com/acme/jingler/issues/7", number: 7 })
    )
    const r2 = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 200 }))
    const routes = make({ fetch: issue as unknown as typeof fetch })
    const res = await post(routes, valid)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ url: "https://github.com/acme/jingler/issues/7", number: 7 })
    expect(r2).toHaveBeenCalledTimes(2)
    const body = JSON.parse((issue.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.body).toContain("https://files.test/bug-reports/")
    expect(body.body).toContain("transcript.md")
    r2.mockRestore()
  })

  it("uploads PNG and JPEG screenshots with the right names, types and bytes", async () => {
    const issue = vi.fn(async () => Response.json({ html_url: "https://github.com/acme/jingler/issues/8", number: 8 }))
    const r2 = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 200 }))
    const routes = make({ fetch: issue as unknown as typeof fetch })
    const res = await post(routes, {
      ...valid,
      transcript: undefined,
      screenshots: [
        { type: "image/png", base64: PNG },
        { type: "image/jpeg", base64: JPG }
      ]
    }, "2.2.2.2")
    expect(res.status).toBe(201)
    const puts = await Promise.all(
      r2.mock.calls.map(async ([input]) => {
        const request = input as Request
        return { url: request.url, type: request.headers.get("content-type"), body: await request.text() }
      })
    )
    const png = puts.find((put) => put.url.endsWith("/screenshot-1.png"))
    const jpg = puts.find((put) => put.url.endsWith("/screenshot-2.jpg"))
    expect(png).toMatchObject({ type: "image/png", body: expect.stringContaining("png-bytes") })
    expect(jpg).toMatchObject({ type: "image/jpeg", body: expect.stringContaining("jpg-bytes") })
    const issueBody = JSON.parse((issue.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).body as string
    expect(issueBody).toContain("![Screenshot 1](https://files.test/bug-reports/")
    expect(issueBody).toContain("screenshot-2.jpg)")
    r2.mockRestore()
  })

  it("deletes uploaded attachments when the GitHub issue fails", async () => {
    const issue = vi.fn(async () => new Response("no", { status: 500 }))
    const r2 = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 200 }))
    const routes = make({ fetch: issue as unknown as typeof fetch })
    const res = await post(routes, valid, "3.3.3.3")
    expect(res.status).toBe(502)
    const methods = r2.mock.calls.map(([input]) => (input as Request).method)
    expect(methods.filter((method) => method === "PUT")).toHaveLength(2)
    expect(methods.filter((method) => method === "DELETE")).toHaveLength(2)
    r2.mockRestore()
  })

  it("rate limits per client IP using the last forwarded entry", async () => {
    const routes = make()
    for (let i = 0; i < 5; i++) await post(routes, { bad: true }, "spoof-" + i + ", 9.9.9.9")
    expect((await post(routes, { bad: true }, "other-spoof, 9.9.9.9")).status).toBe(429)
    expect((await post(routes, { bad: true }, "8.8.8.8")).status).toBe(400)
  })

  it("fails closed when the limiter store is down", async () => {
    const routes = make({ hit: async () => { throw new Error("db down") } })
    expect((await post(routes, valid)).status).toBe(503)
  })

  it("rejects non-JSON content types", async () => {
    const res = await make().request("/", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(valid) })
    expect(res.status).toBe(415)
  })

  it("rejects files whose bytes are not the claimed image type", async () => {
    const html = Buffer.from("<script>alert(1)</script>").toString("base64")
    const res = await post(make(), { ...valid, screenshots: [{ type: "image/png", base64: html }] })
    expect(res.status).toBe(400)
  })

  it("rejects malformed base64 and oversized bodies", async () => {
    expect((await post(make(), { ...valid, screenshots: [{ type: "image/png", base64: "not base64!!" }] })).status).toBe(400)
    expect((await post(make(), { ...valid, description: "x".repeat(5_000_000) })).status).toBe(400)
  })

  it("neutralizes @mentions in the issue title and body", async () => {
    const issue = vi.fn(async () => Response.json({ html_url: "https://github.com/acme/jingler/issues/9", number: 9 }))
    const r2 = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 200 }))
    const res = await post(make({ fetch: issue as unknown as typeof fetch }), { ...valid, title: "hi @acme/core", description: "ping @someone", screenshots: [], transcript: undefined }, "4.4.4.4")
    expect(res.status).toBe(201)
    const sent = JSON.parse((issue.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(sent.title).not.toMatch(/@(?=[\w-])/)
    expect(sent.body).not.toMatch(/@(?=[\w-])/)
    r2.mockRestore()
  })
})
