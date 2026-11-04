import { useState } from "react"
import type { ReactNode } from "react"
import type { HomePullRequest } from "@jingler/core"
import { Check } from "lucide-react"
import { prStatus, type TodoReview } from "./home-today-model.js"
import { Badge } from "../components/badge.js"
import { Button } from "../components/button.js"
import { CollapsibleSection } from "../components/collapsible-section.js"
import { EmptyState, InlineError, ListSkeleton } from "../components/feedback.js"

const MINE_SHOWN = 3

/** Home › one PR: repo#number, title, and its single most important status. */
export function HomePrRow({ pr, done = false, onOpen }: {
  readonly pr: HomePullRequest
  readonly done?: boolean
  readonly onOpen: (url: string) => void
}) {
  const status = prStatus(pr)
  return (
    <Button variant="ghost" onClick={() => onOpen(pr.url)} className="h-auto w-full justify-between gap-3 py-1.5 text-left">
      <span className="flex min-w-0 items-center gap-2">
        {done ? <Check size={13} aria-label="Done" className="flex-none text-green" /> : null}
        <span className="min-w-0">
          <span className={done ? "block truncate text-[13px] text-dim line-through" : "block truncate text-[13px] text-text-bright"}>{pr.title}</span>
          <span className="block truncate font-mono text-[11px] text-dim">{pr.repository}#{pr.number} · {pr.author}</span>
        </span>
      </span>
      <Badge tone={status.tone} size="xs">{status.label}</Badge>
    </Button>
  )
}

type Load<T> = { readonly data: T | undefined; readonly loading: boolean; readonly error: string | null; readonly onRetry: () => void }

function body<T>(load: Load<T>, render: (data: T) => ReactNode) {
  if (load.error !== null) return <InlineError message={load.error} onRetry={load.onRetry} className="mx-3" />
  if (load.data === undefined) return <ListSkeleton rows={3} rowHeight={40} className="px-3" />
  return render(load.data)
}

/** Home › To Do (today's frozen review pick) beside My PRs; stacks on narrow windows. */
export function HomeToday({ reviews, mine, onOpenPr, onOpenAllPrs, open, onOpenChange }: {
  readonly reviews: Load<ReadonlyArray<TodoReview>>
  readonly mine: Load<{ readonly prs: ReadonlyArray<HomePullRequest>; readonly total: number }>
  readonly onOpenPr: (url: string) => void
  /** "+N more" opens the pull request inbox. */
  readonly onOpenAllPrs?: () => void
  readonly open: { readonly todo: boolean; readonly mine: boolean }
  readonly onOpenChange: (section: "todo" | "mine", open: boolean) => void
}) {
  const doneCount = reviews.data?.filter((row) => row.done).length ?? 0
  return (
    <div data-testid="home-today" className="grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2">
      <CollapsibleSection
        data-testid="home-todo"
        title="To do"
        open={open.todo}
        onOpenChange={(next) => onOpenChange("todo", next)}
        trailing={reviews.data && reviews.data.length > 0 ? <span className="normal-case">{doneCount} of {reviews.data.length} done today</span> : undefined}
        className="min-w-0 rounded-lg border border-hairline bg-panel"
      >
        <div className="pb-2">
          {body(reviews, (rows) => rows.length === 0
            ? <EmptyState title="No reviews waiting" className="py-4" />
            : rows.map((row) => row.pr
              ? <HomePrRow key={row.id} pr={row.pr} done={row.done} onOpen={onOpenPr} />
              : <div key={row.id} className="px-3.5 py-1.5 text-[12px] text-dim">{row.done ? "No longer available · done" : "Loading…"}</div>))}
        </div>
      </CollapsibleSection>
      <CollapsibleSection
        data-testid="home-my-prs"
        title="My PRs"
        open={open.mine}
        onOpenChange={(next) => onOpenChange("mine", next)}
        trailing={mine.data ? <Badge tone="count" size="xs">{mine.data.total}</Badge> : undefined}
        className="min-w-0 rounded-lg border border-hairline bg-panel"
      >
        <div className="pb-2">
          {body(mine, ({ prs, total }) => prs.length === 0
            ? <EmptyState title="No open or recent PRs" className="py-4" />
            : <>
                {prs.slice(0, MINE_SHOWN).map((pr) => <HomePrRow key={pr.id} pr={pr} onOpen={onOpenPr} />)}
                {total > MINE_SHOWN && onOpenAllPrs
                  ? <Button variant="ghost" size="sm" onClick={onOpenAllPrs} className="ml-1.5">+{total - MINE_SHOWN} more</Button>
                  : null}
              </>)}
        </div>
      </CollapsibleSection>
    </div>
  )
}

/** Collapsed state for Home sections, remembered per viewer; storage may be unavailable. */
export function useHomeSectionsOpen(storageKey = "jingler.home.sections") {
  const [open, setOpen] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>
      return { todo: raw.todo !== false, mine: raw.mine !== false }
    } catch {
      return { todo: true, mine: true }
    }
  })
  const change = (section: "todo" | "mine", next: boolean) => setOpen((prev) => {
    const value = { ...prev, [section]: next }
    try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* private window */ }
    return value
  })
  return [open, change] as const
}
