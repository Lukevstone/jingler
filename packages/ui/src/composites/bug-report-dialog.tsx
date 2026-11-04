import { useState } from "react"
import { Button } from "../components/button.js"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog.js"
import { Field } from "../components/field.js"
import { Input } from "../components/input.js"
import { Textarea } from "../components/textarea.js"

export interface BugReportScreenshot {
  readonly type: "image/png" | "image/jpeg"
  readonly base64: string
}

export interface BugReportDraft {
  readonly title: string
  readonly description: string
  /** Chat whose transcript to attach; absent attaches none. */
  readonly chatId?: string
  readonly screenshots: readonly BugReportScreenshot[]
}

export interface BugReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chats the reporter may attach the transcript of. */
  chats: readonly { readonly id: string; readonly label: string }[]
  /** Files the report; resolves to the created issue's URL. */
  onSubmit: (draft: BugReportDraft) => Promise<{ url: string }>
}

const MAX_SCREENSHOTS = 5
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/** "Report a bug": title, details, optional chat transcript and screenshots → a GitHub issue. */
export function BugReportDialog({ open, onOpenChange, chats, onSubmit }: BugReportDialogProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [chatId, setChatId] = useState("")
  const [shots, setShots] = useState<readonly (BugReportScreenshot & { name: string })[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [issueUrl, setIssueUrl] = useState<string | null>(null)

  const reset = () => {
    setTitle("")
    setDescription("")
    setChatId("")
    setShots([])
    setError(null)
    setIssueUrl(null)
  }

  const addFiles = async (files: FileList | null) => {
    setError(null)
    const accepted = Array.from(files ?? []).filter((file) => file.type === "image/png" || file.type === "image/jpeg")
    if (accepted.some((file) => file.size > MAX_SCREENSHOT_BYTES)) return setError("Screenshots must be under 4 MB each.")
    const added = await Promise.all(
      accepted.map(async (file) => ({ name: file.name, type: file.type as BugReportScreenshot["type"], base64: await readBase64(file) }))
    )
    setShots((current) => [...current, ...added].slice(0, MAX_SCREENSHOTS))
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { url } = await onSubmit({
        title: title.trim(),
        description: description.trim(),
        ...(chatId ? { chatId } : {}),
        screenshots: shots.map(({ type, base64 }) => ({ type, base64 }))
      })
      setIssueUrl(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the report.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader className="pr-12">
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>Files a GitHub issue for the Jingler team.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {issueUrl ? (
            <p className="text-[13px] text-text-body">
              Thanks, your report was filed:{" "}
              <a href={issueUrl} target="_blank" rel="noreferrer" className="text-text-bright underline">
                {issueUrl}
              </a>
            </p>
          ) : (
            <>
              <Field label="Title" required>
                {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />}
              </Field>
              <Field label="What happened?">
                {(control) => <Textarea {...control} value={description} onChange={(event) => setDescription(event.target.value)} />}
              </Field>
              <Field label="Session transcript" help="The text of the chosen chat is uploaded with the report.">
                {(control) => (
                  <select
                    {...control}
                    value={chatId}
                    onChange={(event) => setChatId(event.target.value)}
                    className="h-8 w-full rounded-lg border border-line bg-transparent px-2 text-[13px] text-text-bright"
                  >
                    <option value="">Don't attach a transcript</option>
                    {chats.map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Screenshots" help={`PNG or JPEG, up to ${MAX_SCREENSHOTS}.`}>
                {(control) => (
                  <>
                    <input
                      {...control}
                      type="file"
                      accept="image/png,image/jpeg"
                      multiple
                      disabled={shots.length >= MAX_SCREENSHOTS}
                      onChange={(event) => {
                        void addFiles(event.target.files)
                        event.target.value = ""
                      }}
                      className="text-[12px] text-text-body"
                    />
                    {shots.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {shots.map((shot, index) => (
                          <li key={`${shot.name}-${index}`} className="relative">
                            <img src={`data:${shot.type};base64,${shot.base64}`} alt={shot.name} className="h-16 rounded-md border border-line" />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${shot.name}`}
                              className="absolute -right-2 -top-2 size-5"
                              onClick={() => setShots((current) => current.filter((_, at) => at !== index))}
                            >
                              ×
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Field>
              {error && (
                <p role="alert" className="text-[12px] text-state-failed">
                  {error}
                </p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {issueUrl ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={busy || title.trim() === ""}>
                {busy ? "Sending…" : "Send report"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
