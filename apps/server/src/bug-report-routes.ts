/** Unauthenticated, rate-limited bug-report intake: attachments to R2, issue to GitHub. */
import { createHash, randomUUID } from "node:crypto"
import { AwsClient } from "aws4fetch"
import { Schema } from "effect"
import { Hono } from "hono"
import { BugReportRateRepository } from "./db/repositories/bug-report-rate-repository.js"
import { env } from "./env.js"
import { decodeBoundedJson } from "./request-decoding.js"
import { runtime } from "./runtime.js"

export const MAX_SCREENSHOTS = 5
// Vercel rejects request bodies over 4.5 MB before the function runs.
const MAX_BODY_BYTES = 4_300_000
// The desktop truncates to this (apps/desktop/src/main/bug-report.ts); keep the two equal.
export const MAX_TRANSCRIPT_CHARS = 300_000
const RATE_LIMIT = 5
const GLOBAL_RATE_LIMIT = 100
const RATE_WINDOW_MS = 60 * 60 * 1_000
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
// Leading bytes of the only formats we host; anything else is rejected so the public bucket can't serve arbitrary files.
const MAGIC = { "image/png": [0x89, 0x50, 0x4e, 0x47], "image/jpeg": [0xff, 0xd8, 0xff] } as const

const ScreenshotType = Schema.Literal("image/png", "image/jpeg")
export const BugReportRequest = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.String.pipe(Schema.maxLength(20_000)),
  appVersion: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
  transcript: Schema.optional(Schema.String.pipe(Schema.maxLength(MAX_TRANSCRIPT_CHARS))),
  screenshots: Schema.Array(
    Schema.Struct({
      type: ScreenshotType,
      base64: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(3_400_000), Schema.pattern(BASE64))
    })
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
  /** Count one hit for `key` in the window and return the shared total. */
  readonly hit: (key: string, window: number) => Promise<number>
  readonly now: () => number
}

const configured = (config: BugReportConfig): boolean => Object.values(config).every(Boolean)

/** Public callers write this text into our repo: stop @mentions from pinging people or teams. */
const neutralize = (text: string): string => text.replace(/@(?=[\w-])/g, "@\u200b")
const hasMagic = (type: keyof typeof MAGIC, bytes: Buffer): boolean =>
  MAGIC[type].every((byte, index) => bytes[index] === byte)

const issueBodyOf = (body: BugReportRequest, links: ReadonlyArray<string>): string =>
  [
    neutralize(body.description) || "_No description provided._",
    body.appVersion ? `\n**App version:** ${body.appVersion}` : "",
    links.length > 0 ? `\n### Attachments\n${links.join("\n")}` : ""
  ].join("\n")

const openIssue = async (
  body: BugReportRequest,
  links: ReadonlyArray<string>,
  config: BugReportConfig,
  request: typeof fetch
): Promise<{ url: string; number: number }> => {
  const res = await request(`https://api.github.com/repos/${config.githubRepo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.githubToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "jingler-bug-report"
    },
    body: JSON.stringify({
      title: neutralize(body.title.replace(/\s+/g, " ").trim()),
      body: issueBodyOf(body, links),
      labels: ["bug-report"]
    })
  })
  if (!res.ok) throw new Error(`GitHub issue failed: ${res.status}`)
  const issue = (await res.json()) as { html_url: string; number: number }
  return { url: issue.html_url, number: issue.number }
}

/** Upload attachments to R2, then open the GitHub issue linking them. Uploads are removed if anything fails. */
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
  const objectUrl = (key: string): string => `${config.r2Endpoint}/${config.r2Bucket}/${key}`
  const uploaded: string[] = []
  const upload = async (name: string, data: BodyInit, type: string): Promise<string> => {
    const key = `${prefix}/${name}`
    const res = await aws.fetch(objectUrl(key), {
      method: "PUT",
      body: data,
      headers: { "content-type": type }
    })
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`)
    uploaded.push(key)
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
  try {
    // allSettled so no upload is still in flight when cleanup runs.
    const settled = await Promise.allSettled([...transcript, ...shots])
    const links = settled.map((result) => {
      if (result.status === "rejected") throw result.reason
      return result.value
    })
    return await openIssue(body, links, config, request)
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((key) => aws.fetch(objectUrl(key), { method: "DELETE" }))
    )
    throw error
  }
}

export const createBugReportRoutes = (
  overrides: Partial<BugReportDependencies> = {}
): Hono => {
  const deps: BugReportDependencies = {
    config: () => env.bugReport,
    fetch: (...args) => fetch(...args),
    hit: (key, window) => runtime.runPromise(BugReportRateRepository.hit(key, window)),
    now: Date.now,
    ...overrides
  }
  // Shared (Postgres) counters so every instance enforces the same quota. Fails closed.
  const limited = async (ip: string): Promise<boolean> => {
    const window = Math.floor(deps.now() / RATE_WINDOW_MS)
    const who = createHash("sha256").update(ip).digest("hex").slice(0, 32)
    if ((await deps.hit(`ip:${who}`, window)) > RATE_LIMIT) return true
    return (await deps.hit("global", window)) > GLOBAL_RATE_LIMIT
  }

  const routes = new Hono()
  routes.post("/", async (c) => {
    const config = deps.config()
    if (!configured(config)) return c.json({ error: "Bug reports are not enabled" }, 503)
    // The last entry is the one our own proxy appended; earlier ones are caller-controlled.
    const ip = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown"
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: "Expected application/json" }, 415)
    }
    try {
      if (await limited(ip)) return c.json({ error: "Too many reports; try again later" }, 429)
    } catch {
      return c.json({ error: "Bug reports are unavailable" }, 503)
    }
    const body = await decodeBoundedJson(c.req.raw, BugReportRequest, MAX_BODY_BYTES)
    if (!body) return c.json({ error: "Invalid bug report" }, 400)
    const bad = body.screenshots.some((shot) => !hasMagic(shot.type, Buffer.from(shot.base64, "base64")))
    if (bad) return c.json({ error: "Screenshots must be real PNG or JPEG images" }, 400)
    try {
      return c.json(await fileReport(body, config, deps.fetch), 201)
    } catch {
      return c.json({ error: "Could not file the bug report" }, 502)
    }
  })
  return routes
}
