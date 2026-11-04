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
  screenshots: [{ type: "image/png", base64: "aGk=" }]
}

describe("bug report routes", () => {
  it("returns 503 when not configured", async () => {
    const routes = createBugReportRoutes({ config: () => ({ ...config, githubToken: "" }) })
    expect((await post(routes, valid)).status).toBe(503)
  })

  it("rejects invalid bodies", async () => {
    const routes = createBugReportRoutes({ config: () => config })
    expect((await post(routes, { title: "" , description: "", screenshots: [] })).status).toBe(400)
  })

  it("uploads attachments to R2 and files the issue with their links", async () => {
    const issue = vi.fn(async () =>
      Response.json({ html_url: "https://github.com/acme/jingler/issues/7", number: 7 })
    )
    const r2 = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 200 }))
    const routes = createBugReportRoutes({ config: () => config, fetch: issue as unknown as typeof fetch })
    const res = await post(routes, valid)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ url: "https://github.com/acme/jingler/issues/7", number: 7 })
    expect(r2).toHaveBeenCalledTimes(2)
    const body = JSON.parse((issue.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.body).toContain("https://files.test/bug-reports/")
    expect(body.body).toContain("transcript.md")
    r2.mockRestore()
  })

  it("rate limits per IP", async () => {
    const routes = createBugReportRoutes({ config: () => config })
    for (let i = 0; i < 5; i++) await post(routes, { bad: true }, "9.9.9.9")
    expect((await post(routes, { bad: true }, "9.9.9.9")).status).toBe(429)
    expect((await post(routes, { bad: true }, "8.8.8.8")).status).toBe(400)
  })
})
