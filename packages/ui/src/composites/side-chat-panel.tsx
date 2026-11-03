import { CornerDownLeft, Maximize2, MessageCircleQuestion, Minimize2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../components/button.js"
import { Input } from "../components/input.js"
import { cn } from "../lib/cn.js"
import { StreamingText } from "./streaming-text.js"

export interface SideChatEntry {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly text: string
  readonly streaming?: boolean
}

export interface SideChatPanelProps {
  readonly messages: ReadonlyArray<SideChatEntry>
  /** True while an answer is streaming; the composer stays usable but send is disabled. */
  readonly busy: boolean
  readonly error?: string | null
  readonly expanded?: boolean
  readonly onAsk: (text: string) => void
  readonly onClose: () => void
  readonly onToggleExpand?: () => void
  readonly className?: string
}

/** Right-hand "Side chat" dock: quick questions about the session that never enter it. */
export function SideChatPanel({
  messages,
  busy,
  error,
  expanded = false,
  onAsk,
  onClose,
  onToggleExpand,
  className
}: SideChatPanelProps) {
  const [draft, setDraft] = useState("")
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }) }, [messages])
  const send = () => {
    const text = draft.trim()
    if (text === "" || busy) return
    onAsk(text)
    setDraft("")
  }
  return (
    <aside
      data-testid="side-chat-panel"
      aria-label="Side chat"
      className={cn("flex h-full min-w-0 flex-col border-l border-line bg-panel", className)}
    >
      <header className="flex items-center gap-1 border-b border-hairline px-3 py-2">
        <span className="flex-1 text-[13px] font-semibold text-text-bright">Side chat</span>
        {onToggleExpand && (
          <Button variant="ghost" size="icon" aria-label={expanded ? "Collapse side chat" : "Expand side chat"} onClick={onToggleExpand}>
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Close side chat" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          Chat about this session without touching the main thread. The agent sees the full context, and nothing here is added to the session.
        </p>
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="ml-6 rounded-lg border border-line px-3 py-2 text-[13px] text-text-bright">
              {message.text}
            </div>
          ) : (
            <div key={message.id} className="min-w-0 text-[13px] text-text-bright">
              <StreamingText text={message.text} streaming={message.streaming ?? false} />
            </div>
          )
        )}
        {error && <p role="alert" className="text-[12px] text-state-failed">{error}</p>}
        <div ref={end} />
      </div>
      <form
        className="flex items-center gap-1 border-t border-hairline p-3"
        onSubmit={(event) => { event.preventDefault(); send() }}
      >
        <Input
          aria-label="Ask a quick question"
          placeholder="Ask a quick question…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-9 min-w-0 flex-1 text-[13px]"
        />
        <Button type="submit" variant="ghost" size="icon" aria-label="Send side question" disabled={busy || draft.trim() === ""}>
          <CornerDownLeft className="size-3.5" />
        </Button>
      </form>
    </aside>
  )
}

/** Opens/closes the side chat dock from the conversation. */
export function SideChatToggleButton({ active, onClick, className }: { active: boolean; onClick: () => void; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={active ? "Close side chat" : "Open side chat"}
      aria-pressed={active}
      onClick={onClick}
      className={cn(active && "bg-text-bright/5 text-text-bright", className)}
    >
      <MessageCircleQuestion className="size-4" />
    </Button>
  )
}
