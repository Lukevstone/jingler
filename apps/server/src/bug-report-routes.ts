/** Unauthenticated, rate-limited bug-report intake: attachments to R2, issue to GitHub. */
import { randomUUID } from "node:crypto"
import { AwsClient } from "aws4fetch"
import { Schema } from "effect"
import { Hono } from "hono"
import { env } from "./env.js"
import { decodeBoundedJson } from "./request-decoding.js"

export const MAX_SCREENSHOTS = 5
const MAX_BODY_BYTES = 20 * 1_024 * 1_024
const MAX_TRANSCRIPT_CHARS = 5_000_000
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1_000

const ScreenshotType = Schema.Literal("image/png", "image/jpeg")
export const BugReportRequest = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.String.pipe(Schema.maxLength(20_000)),
  appVersion: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
  transcript: Schema.optional(Schema.String.pipe(Schema.maxLength(MAX_TRANSCRIPT_CHARS))),
  screenshots: Schema.Array(
    Schema.Struct({ type: ScreenshotType, base64: Schema.String })
  ).pipe(Schema.maxItems(MAX_SCREENSHOTS))
})
export type BugReportRequest = typeof BugReportRequest.Type

export interface BugReportConfig {
  readonly githubToken: string
  readonly githubRepo: string
  readonly r2Endpoint: string
  readonly r2Bucket: string
  readonly r2AccessKeyId: string
  readonly r2SecretAccessKey: string
  readonly r2PublicUrl: string
}

export interface BugReportDependencies {
  readonly config: () => BugReportConfig
  readonly fetch: typeof fetch
  readonly now: () => number
}

const configured = (config: BugReportConfig): boolean => Object.values(config).every(Boolean)

/** Upload attachments to R2, then open the GitHub issue linking them. */
const fileReport = async (
  body: BugReportRequest,
  config: BugReportConfig,
  request: typeof fetch
): Promise<{ url: string; number: number }> => {
  const aws = new AwsClient({
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    service: "s3",
    region: "auto"
  })
  const prefix = `bug-reports/${randomUUID()}`
  const upload = async (name: string, data: BodyInit, type: string): Promise<string> => {
    const key = `${prefix}/${name}`
    const res = await aws.fetch(`${config.r2Endpoint}/${config.r2Bucket}/${key}`, {
      method: "PUT",
      body: data,
      headers: { "content-type": type }
    })
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`)
    return `${config.r2PublicUrl}/${key}`
  }
  const transcript = body.transcript
    ? [
        upload("transcript.md", body.transcript, "text/markdown; charset=utf-8").then(
          (url) => `- [Session transcript](${url})`
        )
      ]
    : []
  const shots = body.screenshots.map((shot, index) =>
    upload(
      `screenshot-${index + 1}.${shot.type === "image/png" ? "png" : "jpg"}`,
      Buffer.from(shot.base64, "base64"),
      shot.type
    ).then((url) => `![Screenshot ${index + 1}](${url})`)
  )
  const links = await Promise.all([...transcript, ...shots])
  const issueBody = [
    body.description || "_No description provided._",
    body.appVersion ? `\n**App version:** ${body.appVersion}` : "",
    links.length > 0 ? `\n### Attachments\n${links.join("\n")}` : ""
  ].join("\n")
  const res = await request(`https://api.github.com/repos/${config.githubRepo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.githubToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "jingler-bug-report"
    },
    body: JSON.stringify({ title: body.title, body: issueBody, labels: ["bug-report"] })
  })
  if (!res.ok) throw new Error(`GitHub issue failed: ${res.status}`)
  const issue = (await res.json()) as { html_url: string; number: number }
  return { url: issue.html_url, number: issue.number }
}

export const createBugReportRoutes = (
  overrides: Partial<BugReportDependencies> = {}
): Hono => {
  const deps: BugReportDependencies = {
    config: () => env.bugReport,
    fetch: (...args) => fetch(...args),
    now: Date.now,
    ...overrides
  }
  // ponytail: per-instance memory limiter; serverless instances don't share it. Move to Postgres/KV if abused.
  const hits = new Map<string, number[]>()
  const limited = (ip: string): boolean => {
    const now = deps.now()
    const recent = (hits.get(ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
    if (recent.length >= RATE_LIMIT) {
      hits.set(ip, recent)
      return true
    }
    hits.set(ip, [...recent, now])
    return false
  }

  const routes = new Hono()
  routes.post("/", async (c) => {
    const config = deps.config()
    if (!configured(config)) return c.json({ error: "Bug reports are not enabled" }, 503)
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    if (limited(ip)) return c.json({ error: "Too many reports; try again later" }, 429)
    const body = await decodeBoundedJson(c.req.raw, BugReportRequest, MAX_BODY_BYTES)
    if (!body) return c.json({ error: "Invalid bug report" }, 400)

    try {
      const issue = await fileReport(body, config, deps.fetch)
      return c.json(issue, 201)
    } catch {
      return c.json({ error: "Could not file the bug report" }, 502)
    }
  })
  return routes
}
