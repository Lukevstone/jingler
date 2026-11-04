import { useRef, useState } from "react"
import { Button } from "../components/button.js"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog.js"
import { Field } from "../components/field.js"
import { Input } from "../components/input.js"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select.js"
import { Textarea } from "../components/textarea.js"

export interface BugReportScreenshot {
  readonly type: "image/png" | "image/jpeg"
  readonly base64: string
}

export interface BugReportDraft {
  readonly title: string
  readonly description: string
  /** Chat whose transcript to attach; absent attaches none. */
  readonly sessionId?: string
  readonly chatId?: string
  readonly screenshots: readonly BugReportScreenshot[]
}

export interface BugReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chats the reporter may attach the transcript of. */
  chats: readonly { readonly id: string; readonly sessionId: string; readonly label: string }[]
  /** Files the report; resolves to the created issue's URL. */
  onSubmit: (draft: BugReportDraft) => Promise<{ url: string }>
}

const MAX_SCREENSHOTS = 5
// Total raw bytes across screenshots. Base64 adds a third, and the whole JSON body
// must stay under the host's 4.5 MB request limit (server MAX_BODY_BYTES = 4.3 MB).
const MAX_SCREENSHOT_TOTAL_BYTES = 2_500_000
const MAX_DESCRIPTION_CHARS = 20_000
const NO_TRANSCRIPT = "none"

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
  const [reading, setReading] = useState(0)
  // Bumped on every close so file reads that finish later can't fill the next draft.
  const draft = useRef(0)
  const [issueUrl, setIssueUrl] = useState<string | null>(null)

  const reset = () => {
    setTitle("")
    setDescription("")
    setChatId("")
    draft.current += 1
    setReading(0)
    setShots([])
    setError(null)
    setIssueUrl(null)
  }

  const addFiles = async (files: FileList | null) => {
    setError(null)
    const room = MAX_SCREENSHOTS - shots.length
    const accepted = Array.from(files ?? [])
      .filter((file) => file.type === "image/png" || file.type === "image/jpeg")
      .slice(0, room)
    const total = [...shots.map(({ base64 }) => base64.length * 0.75), ...accepted.map((file) => file.size)].reduce((sum, n) => sum + n, 0)
    if (total > MAX_SCREENSHOT_TOTAL_BYTES) return setError("Screenshots must total under 2.5 MB.")
    const mine = draft.current
    setReading((n) => n + 1)
    try {
      const added = await Promise.all(
        accepted.map(async (file) => ({ name: file.name, type: file.type as BugReportScreenshot["type"], base64: await readBase64(file) }))
      )
      if (mine === draft.current) setShots((current) => [...current, ...added].slice(0, MAX_SCREENSHOTS))
    } catch {
      if (mine === draft.current) setError("Could not read one of the selected files.")
    } finally {
      if (mine === draft.current) setReading((n) => n - 1)
    }
  }

  const close = () => {
    if (busy) return
    reset()
    onOpenChange(false)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const chat = chats.find(({ id }) => id === chatId)
      const { url } = await onSubmit({
        title: title.trim(),
        description: description.trim(),
        ...(chat ? { sessionId: chat.sessionId, chatId: chat.id } : {}),
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
        if (next) onOpenChange(true)
        else close()
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
                {(control) => <Textarea {...control} value={description} maxLength={MAX_DESCRIPTION_CHARS} onChange={(event) => setDescription(event.target.value)} />}
              </Field>
              <Field label="Session transcript" help="The chat text is uploaded to an unlisted but public link, and anyone with the link can read it. Skip it if the chat contains secrets or private code.">
                {(control) => (
                  <Select value={chatId || NO_TRANSCRIPT} onValueChange={(value) => setChatId(value === NO_TRANSCRIPT ? "" : value)}>
                    <SelectTrigger ariaLabel="Session transcript">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TRANSCRIPT} textValue="Don't attach a transcript">Don't attach a transcript</SelectItem>
                      {chats.map((chat) => (
                        <SelectItem key={chat.id} value={chat.id} textValue={chat.label}>
                          {chat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Screenshots" help={`PNG or JPEG, up to ${MAX_SCREENSHOTS} and 2.5 MB total. Uploaded to unlisted public links.`}>
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
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={busy || reading > 0 || title.trim() === ""}>
                {busy ? "Sending…" : "Send report"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
