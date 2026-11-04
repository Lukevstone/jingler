import type { Message } from "@jingler/core"

export interface BugReportInput {
  readonly title: string
  readonly description: string
  readonly appVersion: string
  readonly messages: ReadonlyArray<Message>
  readonly screenshots: ReadonlyArray<{ readonly type: "image/png" | "image/jpeg"; readonly base64: string }>
}

/** Must equal MAX_TRANSCRIPT_CHARS in apps/server/src/bug-report-routes.ts. */
export const MAX_TRANSCRIPT_CHARS = 300_000

/** Text-only markdown of a chat; images and tool cards are left out. Keeps the newest turns if too long. */
export const transcriptMarkdown = (messages: ReadonlyArray<Message>): string => {
  const full = turnsMarkdown(messages)
  return full.length > MAX_TRANSCRIPT_CHARS ? full.slice(-MAX_TRANSCRIPT_CHARS) : full
}

const turnsMarkdown = (messages: ReadonlyArray<Message>): string =>
  messages
    .flatMap((message) => {
      const text = message.parts.flatMap((part) => (part._tag === "Text" ? [part.text] : [])).join("\n\n")
      return text.trim() === "" ? [] : [`### ${message.role}\n\n${text}`]
    })
    .join("\n\n")

const baseUrl = (): string => (process.env.JINGLER_AUTH_URL ?? "http://localhost:9100").replace(/\/$/, "")

/** POST the report to the server, which uploads attachments and files the GitHub issue. */
export const submitBugReport = async (
  input: BugReportInput,
  request: typeof fetch = fetch
): Promise<{ url: string }> => {
  const transcript = transcriptMarkdown(input.messages)
  const response = await request(`${baseUrl()}/api/bug-reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      appVersion: input.appVersion,
      ...(transcript === "" ? {} : { transcript }),
      screenshots: input.screenshots
    })
  })
  const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null
  if (!response.ok || !body?.url) throw new Error(body?.error ?? `Bug report failed (${response.status})`)
  return { url: body.url }
}
