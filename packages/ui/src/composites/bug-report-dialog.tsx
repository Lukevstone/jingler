import { useEffect, useRef, useState } from "react"
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
const ONLY_IMAGES = "Only PNG or JPEG images can be attached."
// Leading bytes of the formats we accept. A file's claimed type is not trusted: the bytes must match too.
const MAGIC: Record<BugReportScreenshot["type"], readonly number[]> = { "image/png": [0x89, 0x50, 0x4e, 0x47], "image/jpeg": [0xff, 0xd8, 0xff] }
const isImageType = (type: string): type is BugReportScreenshot["type"] => type === "image/png" || type === "image/jpeg"
const hasMagic = (type: BugReportScreenshot["type"], base64: string): boolean => {
  const head = atob(base64.slice(0, 8))
  return MAGIC[type].every((byte, index) => head.charCodeAt(index) === byte)
}

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const TOO_BIG = "Screenshots must total under 2.5 MB."

/** Which dropped/pasted files to read: images only, within the count and size budget. */
const planFiles = (files: readonly File[], shots: readonly { readonly base64: string }[], room: number) => {
  const accepted = files.filter((file) => isImageType(file.type)).slice(0, room)
  const bytes = shots.reduce((sum, { base64 }) => sum + base64.length * 0.75, 0) + accepted.reduce((sum, file) => sum + file.size, 0)
  const error = bytes > MAX_SCREENSHOT_TOTAL_BYTES ? TOO_BIG : accepted.length < files.length ? ONLY_IMAGES : null
  return { accepted, error }
}

const readShot = async (file: File) => ({
  name: file.name || "pasted-image",
  type: file.type as BugReportScreenshot["type"],
  base64: await readBase64(file)
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
  const [dragging, setDragging] = useState(false)
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

  const addFiles = async (files: readonly File[]) => {
    const plan = planFiles(files, shots, MAX_SCREENSHOTS - shots.length)
    setError(plan.error)
    if (plan.accepted.length === 0 || plan.error === TOO_BIG) return
    const mine = draft.current
    setReading((n) => n + 1)
    try {
      const read = await Promise.all(plan.accepted.map(readShot))
      const added = read.filter((shot) => hasMagic(shot.type, shot.base64))
      if (mine !== draft.current) return
      if (added.length < read.length) setError(ONLY_IMAGES)
      setShots((current) => [...current, ...added].slice(0, MAX_SCREENSHOTS))
    } catch {
      if (mine === draft.current) setError("Could not read one of the selected files.")
    } finally {
      if (mine === draft.current) setReading((n) => n - 1)
    }
  }

  // Paste works anywhere in the dialog; plain text pastes (no files) are left alone.
  const latestAddFiles = useRef(addFiles)
  latestAddFiles.current = addFiles
  useEffect(() => {
    if (!open || issueUrl) return
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      void latestAddFiles.current(files)
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [open, issueUrl])

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
                    <SelectContent inline className="mt-1 w-full">
                      <SelectItem value={NO_TRANSCRIPT} textValue="Don't attach a transcript">Don't attach a transcript</SelectItem>
                      {chats.length === 0 && <SelectItem value="__empty" disabled textValue="No chats yet">No chats yet</SelectItem>}
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
                    <div
                      data-testid="screenshot-dropzone"
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        void addFiles(Array.from(event.dataTransfer.files))
                      }}
                      className={`flex flex-col items-start gap-1.5 rounded-xl border border-dashed px-3.5 py-3 text-[12px] text-text-body transition-colors ${dragging ? "border-text-bright/60 bg-surface" : "border-line"}`}
                    >
                      <span>Drop images here, paste them, or choose files.</span>
                      <input
                        {...control}
                        type="file"
                        accept="image/png,image/jpeg"
                        multiple
                        disabled={shots.length >= MAX_SCREENSHOTS}
                        onChange={(event) => {
                          void addFiles(Array.from(event.target.files ?? []))
                          event.target.value = ""
                        }}
                      />
                    </div>
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
