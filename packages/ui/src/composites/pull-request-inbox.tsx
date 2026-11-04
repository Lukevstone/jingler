import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useMachine } from "@xstate/react"
import { Select, SelectContent, SelectItem, SelectSearch, SelectTrigger } from "../components/beui/select.js"
import { initialInboxFilters, pullRequestInboxFilterMachine, type PullRequestInboxFacets, type PullRequestInboxFilter } from "./pull-request-inbox-filter-machine.js"
import { matchesPrSearch, type GitHubTeam, type GitHubTeamQueue, type PrMergeMethod, type PrSearchFilters, type PullRequest, type PullRequestListItem, type ReviewComment } from "@jingler/core"
import { ArrowLeft, GitPullRequest, MessageSquare } from "lucide-react"
import { Avatar, githubAvatarUrl } from "../components/avatar.js"
import { Badge } from "../components/badge.js"
import { DiffStat } from "../components/diff-stat.js"
import { EmptyState, InlineError, ListSkeleton } from "../components/feedback.js"
import { Button } from "../components/button.js"
import { FilterChips } from "../components/filter-chips.js"
import { Input } from "../components/input.js"
import { ResizeHandle, useResizableWidth } from "../components/resizable.js"
import { SearchField } from "../components/search-input.js"
import { atLeast, useWidthTier, WidthTierProvider } from "../hooks/width-tier.js"
import { useActivateOnFocus } from "../hooks/use-activate-on-focus.js"
import { cn } from "../lib/cn.js"
import { relativeTime } from "../lib/relative-time.js"
import { PullRequestView } from "./pull-request-view.js"
import type { ReviewRun } from "./review-drawer.js"
import type { ReviewFindingDraft } from "./review-drawer-machine.js"

export type { PullRequestInboxFilter, PullRequestInboxFacets } from "./pull-request-inbox-filter-machine.js"

const FILTERS: ReadonlyArray<{ value: PullRequestInboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "created", label: "Created" },
  { value: "assigned", label: "Assigned" },
  { value: "review-requested", label: "Review requested" }
]

const THIS_SESSION_FILTER = { value: "this-session", label: "This session" } as const

const filterOptionsFor = (sessionKeys?: ReadonlySet<string>) =>
  sessionKeys ? [...FILTERS, THIS_SESSION_FILTER] : FILTERS

const keyOf = (pr: Pick<PullRequestListItem, "repository" | "number">) =>
  `${pr.repository}#${pr.number}`

const hasActiveInboxFilters = (filters: typeof initialInboxFilters) => Boolean(
  filters.query || filters.filter !== "all" || filters.repository || filters.author || filters.label || filters.draft !== "all"
)

/** What the host should load: a GitHub search, or the visible session's linked PRs by key. */
export type PullRequestInboxQuery =
  | { readonly kind: "search"; readonly filters: PrSearchFilters }
  | { readonly kind: "session"; readonly keys: ReadonlyArray<{ readonly repository: string; readonly number: number }> }

const sessionKeysOf = (keys: ReadonlySet<string>) => [...keys].flatMap((key) => {
  const match = /^(.+)#(\d+)$/.exec(key)
  return match ? [{ repository: match[1]!, number: Number(match[2]) }] : []
})

/** Every facet becomes part of the query; team mode ignores the personal relationship. */
export const inboxQueryOf = (filters: typeof initialInboxFilters, team: boolean, sessionKeys?: ReadonlySet<string>): PullRequestInboxQuery => {
  if (!team && filters.filter === "this-session") return { kind: "session", keys: sessionKeysOf(sessionKeys ?? new Set()) }
  return { kind: "search", filters: {
    relationship: team || filters.filter === "this-session" ? "all" : filters.filter,
    repository: filters.repository.trim(), author: filters.author.trim(), label: filters.label.trim(),
    draft: filters.draft, text: filters.query.trim(),
  } }
}

const TYPING_DEBOUNCE_MS = 400

/** Calls `onLoadMore` when the returned sentinel scrolls into view; a failed page pauses it until an explicit Retry. */
function useLoadMoreSentinel(hasMore: boolean, error: string | null, onLoadMore: (() => void) | undefined, rows: number) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || error !== null || !onLoadMore || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoadMore() }, { rootMargin: "200px" })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, error, onLoadMore, rows])
  return sentinel
}

function LoadMoreFooter({ loadingMore, error, onLoadMore }: { loadingMore: boolean; error: string | null; onLoadMore?: () => void }) {
  return error !== null
    ? <InlineError message={error} onRetry={onLoadMore} />
    : <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</Button>
}

/** Typed fields of a serialized query; a change here waits for the debounce, anything else applies at once. */
const typedFieldsOf = (raw: string | null) => {
  if (raw === null) return null
  const filters = (JSON.parse(raw) as { filters?: Partial<PrSearchFilters> }).filters
  return JSON.stringify([filters?.text ?? "", filters?.author ?? "", filters?.label ?? ""])
}

/** Search rows are already filtered by GitHub; session rows are fetched by key, so filter them here. */
const visibleRows = (
  prs: ReadonlyArray<PullRequestListItem>, query: PullRequestInboxQuery,
  facets: typeof initialInboxFilters, team: boolean, viewerLogin: string
) => {
  if (query.kind !== "session") return prs
  const { filters } = inboxQueryOf({ ...facets, filter: "all" }, team) as { filters: PrSearchFilters }
  return prs.filter((pr) => matchesPrSearch(pr, filters, viewerLogin))
}

export interface PullRequestInboxProps {
  prs: ReadonlyArray<PullRequestListItem>
  teamControls?: {
    readonly teams: ReadonlyArray<GitHubTeam>
    readonly teamId: string | null
    readonly queue: GitHubTeamQueue
    readonly onTeam: (id: string | null) => void
    readonly onQueue: (queue: GitHubTeamQueue) => void
    readonly onRefresh: () => void
    readonly discovering: boolean
    readonly error: string | null
  }
  onActivate?: () => void
  /** Lowercase `owner/repo#number` keys of the visible session's main + child PRs; enables the "This session" filter. */
  sessionPrKeys?: ReadonlySet<string>
  warnings?: ReadonlyArray<string>
  viewerLogin: string
  selected: { repository: string; number: number } | null
  detail: PullRequest | null
  onSelect: (pr: PullRequestListItem) => void
  onOpenOnGithub?: (url: string) => void
  onOpenFiles?: () => void
  onComment?: (body: string) => Promise<void> | void
  onClosePr?: () => Promise<void> | void
  onMerge?: (method: PrMergeMethod) => Promise<void> | void
  closing?: boolean
  closeError?: string | null
  merging?: boolean
  mergeError?: string | null
  /** Scripted/agent draft findings for the opened PR; enables the Review drawer. */
  reviewDrafts?: ReadonlyArray<ReviewFindingDraft>
  reviewRun?: ReviewRun
  onPromoteReview?: (summary: string) => void
  onSubmitInlineReview?: (input: { body: string; comments: ReadonlyArray<ReviewComment> }) => Promise<void> | void
  sessionAction?: {
    readonly label: string
    readonly onSelect: () => void
    readonly disabledReason?: string
  }
  loading?: boolean
  detailLoading?: boolean
  detailError?: string | null
  error?: string | null
  /** Re-runs the failed list load; the error row only shows Retry when this is given. */
  onRetry?: () => void
  /** Filters changed (typing debounced); the host loads matching PRs. */
  onQueryChange?: (query: PullRequestInboxQuery) => void
  /** GitHub's match count for the current query. */
  total?: number
  hasMore?: boolean
  loadingMore?: boolean
  /** Next page; called when the end of the list scrolls into view. */
  onLoadMore?: () => void
  /** The last next-page load failed; paging waits for an explicit Retry. */
  loadMoreError?: string | null
  /** Every repository the account can see, loaded in the background. */
  repositoryOptions?: ReadonlyArray<string>
}

/** The list column: full width when compact, otherwise a drag-resizable, remembered width. */
function InboxListColumn({ compact, children }: { compact: boolean; children: ReactNode }) {
  const list = useResizableWidth({ storageKey: "jingler.prInbox.listWidth", initial: 360, min: 280, max: 720 })
  const className = "flex min-h-0 min-w-0 flex-col border-r border-line bg-panel"
  if (compact) return <section data-testid="pull-request-list" className={cn(className, "flex-1")}>{children}</section>
  return (
    <>
      <section data-testid="pull-request-list" style={{ width: list.width }} className={cn(className, "flex-none")}>{children}</section>
      <ResizeHandle aria-label="Resize pull request list" onResize={(dx) => list.adjust(dx)} />
    </>
  )
}

/** Global GitHub-style PR list with a responsive read-only detail pane. */
export function PullRequestInbox({
  prs,
  teamControls,
  onActivate,
  sessionPrKeys,
  warnings = [],
  viewerLogin,
  selected,
  detail,
  onSelect,
  onOpenOnGithub,
  onOpenFiles,
  onComment,
  onClosePr,
  onMerge,
  closing,
  closeError,
  merging,
  mergeError,
  sessionAction,
  reviewDrafts,
  reviewRun,
  onPromoteReview,
  onSubmitInlineReview,
  loading = false,
  detailLoading = false,
  detailError = null,
  error = null,
  onRetry,
  onQueryChange,
  total,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  loadMoreError = null,
  repositoryOptions = []
}: PullRequestInboxProps) {
         function renderSelectedPullRequest() {
           return (<PullRequestView
              key={selectedKey ?? "none"}
              pr={detail}
              connected
              busy={detailLoading}
              viewerLogin={viewerLogin}
              readOnly
              reviewDrafts={sessionAction?.label === "Open session" ? undefined : reviewDrafts}
              reviewRun={reviewRun}
              onPromoteReview={onPromoteReview}
              onSubmitInlineReview={onSubmitInlineReview}
              onOpenSession={sessionAction?.onSelect}
              sessionActionLabel={sessionAction?.label}
              sessionActionDisabledReason={sessionAction?.disabledReason}
              onOpenOnGithub={detail?.url && onOpenOnGithub ? () => onOpenOnGithub(detail.url) : undefined}
              onOpenFiles={onOpenFiles}
              onComment={onComment}
              onClosePr={onClosePr}
              onMerge={onMerge}
              closing={closing}
              closeError={closeError}
              merging={merging}
              mergeError={mergeError}
            />)
         }

  function renderDetailPane() {
    if (selected === null) return <InboxMessage><GitPullRequest className="size-6 text-dim" />Select a pull request to review it.</InboxMessage>
    if (detailError && detail === null) return <InboxMessage>{detailError}</InboxMessage>
    return <>
      {detailError && <p role="alert" className="px-4 py-2 text-xs text-red">{detailError}</p>}
      {renderSelectedPullRequest()}
    </>
  }

         function getLoading() {
           if (loading) return <ListSkeleton rows={8} rowHeight={52} gap={6} className="p-4" />
           if (error) return <div className="p-4"><InlineError message={error} onRetry={onRetry} /></div>
           if (visible.length === 0) return (<EmptyState
              className="min-h-48 justify-center"
              icon={<GitPullRequest className="size-5" />}
              title={warnings.length > 0 ? "No pull requests loaded" : "No pull requests match this view"}
              description={warnings.length > 0 ? "Some results could not be retrieved." : undefined}
              action={hasActiveInboxFilters(facets) ? <Button variant="secondary" size="sm" onClick={() => sendFilters({ type: "CLEAR" })}>Clear filters</Button> : undefined}
            />)
           return (visible.map((pr) => {
              const active = keyOf(pr) === selectedKey
              return (
                <button
                  key={keyOf(pr)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onSelect(pr)
                    if (compact) setMobileDetail(true)
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "bg-selection" : "hover:bg-surface"
                  )}
                >
                  <Avatar initial={(pr.author.login[0] ?? "?").toUpperCase()} src={pr.author.avatarUrl ?? githubAvatarUrl(pr.author.login, 32)} size={20} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-bright">{pr.title}</span>
                      {pr.isDraft && <Badge tone="neutral" size="xs">Draft</Badge>}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-dim">
                      <span className="truncate">{pr.repository}</span>
                      <span>#{pr.number}</span>
                      {pr.comments > 0 && <span className="flex items-center gap-1"><MessageSquare className="size-3" />{pr.comments}</span>}
                    </span>
                  </span>
                  <DiffStat added={pr.additions} removed={pr.deletions} />
                  <span className="w-8 flex-none text-right font-mono text-[11px] text-dim">{relativeTime(pr.updatedAt)}</span>
                </button>
              )
            }))
         }

  const [filterState, sendFilters] = useMachine(pullRequestInboxFilterMachine)
  const facets = filterState.context
  const { filter, query } = facets
  const setFilter = (next: PullRequestInboxFilter) => sendFilters({ type: "CHANGE", fields: { filter: next } })
  const setQuery = (next: string) => sendFilters({ type: "CHANGE", fields: { query: next } })
  const repositories = useMemo(() => filterOptions([...repositoryOptions, ...prs.map((pr) => pr.repository)]), [repositoryOptions, prs])
  const suggestions = useMemo(() => ({
    author: [...new Set(prs.map((pr) => pr.author.login))].sort(),
    label: [...new Set(prs.flatMap((pr) => pr.labels.map((label) => label.name)))].sort(),
  }), [prs])
  const [mobileDetail, setMobileDetail] = useState(false)
  const compact = !atLeast(useWidthTier(), "mid")
  const isTeam = Boolean(teamControls?.teamId)
  const inboxQuery = inboxQueryOf(facets, isTeam, sessionPrKeys)
  const nextQuery = JSON.stringify(inboxQuery)
  // Search rows are already filtered by GitHub; session rows are fetched by key, so filter them here.
  const visible = useMemo(() => visibleRows(prs, JSON.parse(nextQuery) as PullRequestInboxQuery, facets, isTeam, viewerLogin),
    [prs, nextQuery, facets, isTeam, viewerLogin])
  const sentQuery = useRef<string | null>(null)
  useEffect(() => {
    if (!onQueryChange || nextQuery === sentQuery.current) return
    const send = () => { sentQuery.current = nextQuery; onQueryChange(JSON.parse(nextQuery) as PullRequestInboxQuery) }
    if (sentQuery.current === null || typedFieldsOf(sentQuery.current) === typedFieldsOf(nextQuery)) return send()
    const timer = setTimeout(send, TYPING_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [nextQuery, onQueryChange])
  const sentinel = useLoadMoreSentinel(hasMore, loadMoreError, onLoadMore, visible.length)
  useActivateOnFocus(onActivate)
  const selectedKey = selected ? `${selected.repository}#${selected.number}` : null
  const showList = !(compact && mobileDetail && selected !== null)

  return (
    <div data-testid="pull-request-inbox" className="flex min-h-0 min-w-0 flex-1 bg-editor">
      {showList && (
        <InboxListColumn compact={compact}>
          <header className="flex flex-none flex-col gap-3 border-b border-line px-4 py-3.5">
            <div className="flex items-center gap-2">
              <GitPullRequest className="size-4 text-muted-foreground" />
              <h1 className="text-[14px] font-semibold text-text-bright">Pull requests</h1>
              <Badge tone="count" size="xs">{visible.length}</Badge>
            </div>
            <SearchField value={query} onChange={setQuery} placeholder="Search pull requests" />
            {teamControls ? <InboxTeamControls controls={teamControls} filter={filter} onFilter={setFilter} sessionPrKeys={sessionPrKeys} />
              : <FilterChips options={filterOptionsFor(sessionPrKeys)} value={filter} onChange={setFilter} ariaLabel="Pull request filter" />}
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <InboxFilterSelect label="Repository" value={facets.repository} options={[{ value: "", label: "All" }, ...repositories]}
                onChange={(value) => sendFilters({ type: "CHANGE", fields: { repository: value } })} />
              {(["author", "label"] as const).map((kind) => <InboxTypeahead
                key={kind} label={kind === "author" ? "Author" : "Label"} value={facets[kind]} suggestions={suggestions[kind]}
                onChange={(value) => sendFilters({ type: "CHANGE", fields: { [kind]: value } })}
              />)}
              <InboxFilterSelect label="Draft status" value={facets.draft} searchable={false}
                options={[{ value: "all", label: "All" }, { value: "draft", label: "Draft" }, { value: "ready", label: "Ready" }]}
                onChange={(value) => sendFilters({ type: "CHANGE", fields: { draft: value === "draft" || value === "ready" ? value : "all" } })}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{total !== undefined && total > visible.length ? `Showing ${visible.length} of ${total}` : `${visible.length} PR${visible.length === 1 ? "" : "s"}`}</span>
              {hasActiveInboxFilters(facets) &&
                <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2" onClick={() => sendFilters({ type: "CLEAR" })}>Clear filters</Button>}
            </div>
            {warnings.length > 0 && <div role="status" className="text-xs text-muted-foreground">
              <strong>Partial results</strong>
              {warnings.map((warning) => <p key={warning}>{warning}</p>)}
              <p>Use Refresh to retry missing results.</p>
            </div>}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {getLoading()}
            {hasMore && !loading && !error && <div ref={sentinel} className="flex justify-center p-3">
              <LoadMoreFooter loadingMore={loadingMore} error={loadMoreError} onLoadMore={onLoadMore} />
            </div>}
          </div>
        </InboxListColumn>
      )}

      {(!compact || mobileDetail) && (
        <WidthTierProvider className="relative bg-editor">
          {compact && (
            <Button variant="outline" size="sm" onClick={() => setMobileDetail(false)} className="absolute left-3 top-3 z-20 bg-panel">
              <ArrowLeft className="size-3.5" /> Back
            </Button>
          )}
          {renderDetailPane()}
        </WidthTierProvider>
      )}
    </div>
  )
}

function InboxTeamControls({ controls: teamControls, filter, onFilter: setFilter, sessionPrKeys }: {
  sessionPrKeys?: ReadonlySet<string>
  controls: NonNullable<PullRequestInboxProps["teamControls"]>
  filter: PullRequestInboxFilter
  onFilter: (filter: PullRequestInboxFilter) => void
}) {
  return <>
            <>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Pull request scope"
                  value={teamControls.teamId ?? ""}
                  onChange={(event) => teamControls.onTeam(event.target.value || null)}
                  disabled={teamControls.discovering}
                  className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1.5 text-xs text-text focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Personal</option>
                  {[...new Set(teamControls.teams.map((team) => team.organization))].map((organization) =>
                    <optgroup key={organization} label={organization}>
                      {teamControls.teams.filter((team) => team.organization === organization).map((team) =>
                        <option key={team.id} value={team.id} disabled={teamControls.error !== null}>{team.name}</option>)}
                    </optgroup>)}
                </select>
                <Button variant="outline" size="sm" onClick={teamControls.onRefresh} disabled={teamControls.discovering}>
                  {teamControls.discovering ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
              {teamControls.error && <p role="alert" className="text-xs text-red">{teamControls.error}</p>}
              {!teamControls.discovering && !teamControls.error && teamControls.teams.length === 0 && <p className="text-xs text-muted-foreground">No organization teams are visible to your GitHub CLI account.</p>}
            </>
            {teamControls.teamId !== null ? <select
              aria-label="Team pull request queue"
              value={teamControls.queue}
              onChange={(event) => teamControls.onQueue(event.target.value as GitHubTeamQueue)}
              disabled={teamControls.discovering || teamControls.error !== null}
              className="rounded border border-line bg-surface px-2 py-1.5 text-xs text-text focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="reviews">Requested reviews</option>
              <option value="authored">Member-authored</option>
              <option value="repositories">Team repositories</option>
            </select> : <FilterChips options={filterOptionsFor(sessionPrKeys)} value={filter} onChange={setFilter} ariaLabel="Pull request filter" />}
  </>
}

export const filterOptions = (values: ReadonlyArray<string>) =>
  [...new Map(values.map((label) => [label.toLowerCase(), { value: label.toLowerCase(), label }])).values()]
    .sort((a, b) => a.label.localeCompare(b.label))

export function InboxFilterSelect({ label, value, options, onChange, searchable = true }: {
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
  searchable?: boolean
}) {
  const selected = options.find((option) => option.value === value)?.label ?? value
  return <Select value={value} onValueChange={onChange} className="min-w-0">
    <SelectTrigger ariaLabel={`Filter by ${label.toLowerCase()}`} className="h-8 w-full min-w-0 text-xs">
      <span className="truncate" title={`${label}: ${selected}`}>{label}: {selected}</span>
    </SelectTrigger>
    <SelectContent listMaxHeight={240} listClassName="overflow-y-auto overscroll-contain"
      search={searchable ? <SelectSearch aria-label={`Search ${label.toLowerCase()} options`} /> : undefined}>
      {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>
}

/** Free-text filter with suggestions from loaded rows; any typed value is searched as-is. */
function InboxTypeahead({ label, value, suggestions, onChange }: {
  label: string
  value: string
  suggestions: ReadonlyArray<string>
  onChange: (value: string) => void
}) {
  const listId = `pr-inbox-${label.toLowerCase()}-suggestions`
  return <>
    <Input aria-label={`Filter by ${label.toLowerCase()}`} placeholder={`${label}: All`} value={value} list={listId}
      onChange={(event) => onChange(event.target.value)} className="h-8 min-w-0 text-xs" />
    <datalist id={listId}>{suggestions.map((option) => <option key={option} value={option} />)}</datalist>
  </>
}

export function InboxMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-muted-foreground">{children}</div>
}
