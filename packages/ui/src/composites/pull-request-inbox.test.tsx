import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { PullRequest, PullRequestListItem } from "@jingler/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WidthTierValue } from "../hooks/width-tier.js"
import { inboxQueryOf, PullRequestInbox } from "./pull-request-inbox.js"
import { initialInboxFilters } from "./pull-request-inbox-filter-machine.js"

const item = (over: Partial<PullRequestListItem> = {}): PullRequestListItem => ({
  repository: "acme/widget",
  number: 42,
  title: "Fix token refresh",
  headRefName: "fix/token",
  baseRefName: "main",
  author: { login: "morgan", avatarUrl: null },
  state: "open",
  isDraft: false,
  additions: 12,
  deletions: 4,
  updatedAt: "2026-08-01T10:00:00.000Z",
  labels: [],
  comments: 2,
  assignedToViewer: false,
  reviewRequestedFromViewer: false,
  ...over
})

const detail: PullRequest = {
  ...item(),
  body: "Refresh expired tokens before retrying the request.",
  url: "https://github.com/acme/widget/pull/42",
  createdAt: "2026-08-01T09:00:00.000Z",
  commits: 2,
  changedFiles: 1,
  reviewers: [],
  timeline: [],
  reviewThreads: [],
  checks: [],
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  mergeBlockers: []
}

const UPDATE_API = /Update API/
const FIX_TOKEN_REFRESH = /Fix token refresh/

const prs = [
  item(),
  item({ repository: "acme/api", number: 7, title: "Update API", author: { login: "lee", avatarUrl: null }, assignedToViewer: true }),
  item({ repository: "acme/web", number: 9, title: "Review login", author: { login: "sam", avatarUrl: null }, reviewRequestedFromViewer: true })
]

afterEach(cleanup)

describe("PullRequestInbox", () => {
  it("turns every facet into the search query, so paging never hides matches", () => {
    const facets = { ...initialInboxFilters, filter: "assigned" as const, query: " token ", repository: "acme/widget", author: "lee", label: "Bug", draft: "draft" as const }
    expect(inboxQueryOf(facets, false)).toEqual({ kind: "search", filters: {
      relationship: "assigned", repository: "acme/widget", author: "lee", label: "Bug", draft: "draft", text: "token"
    } })
    // Team queues own the scope, so the personal relationship is dropped.
    expect(inboxQueryOf(facets, true)).toMatchObject({ kind: "search", filters: { relationship: "all", author: "lee" } })
  })

  it("This session loads the linked PRs by key instead of searching", () => {
    expect(inboxQueryOf({ ...initialInboxFilters, filter: "this-session" }, false, new Set(["acme/widget#42"])))
      .toEqual({ kind: "session", keys: [{ repository: "acme/widget", number: 42 }] })
  })

  it("sends filter changes to the host, offers every repository and keeps the comment draft", async () => {
    const onQueryChange = vi.fn()
    render(<WidthTierValue width={1200}><PullRequestInbox prs={prs} viewerLogin="morgan" total={40} hasMore
      repositoryOptions={["acme/remote-only"]} onQueryChange={onQueryChange}
      selected={prs[0]!} detail={detail} onSelect={() => {}} onComment={async () => {}}
    /></WidthTierValue>)
    expect(onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "search" }))
    const composer = screen.getByPlaceholderText("Leave a comment…")
    fireEvent.change(composer, { target: { value: "Keep this draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Filter by repository" }))
    fireEvent.click(screen.getByRole("option", { name: "acme/remote-only" }))
    await waitFor(() => expect(onQueryChange).toHaveBeenLastCalledWith({ kind: "search", filters: expect.objectContaining({ repository: "acme/remote-only" }) }))
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by label" }), { target: { value: "Bug" } })
    await waitFor(() => expect(onQueryChange).toHaveBeenLastCalledWith({ kind: "search", filters: expect.objectContaining({ label: "Bug" }) }))
    expect(screen.getByText("Showing 3 of 40")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy()
    expect(composer).toHaveProperty("value", "Keep this draft")
  })

  it("shows team queues independently of personal relationships and exposes partial results/refresh", () => {
    const onTeam = vi.fn()
    const onQueue = vi.fn()
    const onRefresh = vi.fn()
    const onActivate = vi.fn()
    render(<WidthTierValue width={1200}><PullRequestInbox
      prs={prs} viewerLogin="someone-else" selected={null} detail={null} onSelect={() => {}}
      onActivate={onActivate}
      teamControls={{
        teams: [{ id: "7", organization: "acme", slug: "platform", name: "Platform" }],
        teamId: "7", queue: "reviews", onTeam, onQueue, onRefresh, discovering: false, error: null,
      }}
      warnings={["GitHub search timed out."]}
    /></WidthTierValue>)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: UPDATE_API })).toBeTruthy()
    expect(screen.getByText("Partial results")).toBeTruthy()
    fireEvent.change(screen.getByRole("combobox", { name: "Team pull request queue" }), { target: { value: "authored" } })
    expect(onQueue).toHaveBeenCalledWith("authored")
    fireEvent.change(screen.getByRole("combobox", { name: "Pull request scope" }), { target: { value: "" } })
    expect(onTeam).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("selects a pull request from the list", () => {
    const onSelect = vi.fn()
    render(
      <WidthTierValue width={1200}>
        <PullRequestInbox prs={prs} viewerLogin="morgan" selected={null} detail={null} onSelect={onSelect} />
      </WidthTierValue>
    )

    fireEvent.click(screen.getByRole("button", { name: UPDATE_API }))
    expect(onSelect).toHaveBeenCalledWith(prs[1])
  })

  it("invokes the selected pull request session action", () => {
    const onSelect = vi.fn()
    render(
      <WidthTierValue width={1200}>
        <PullRequestInbox
          prs={prs}
          viewerLogin="morgan"
          selected={{ repository: "acme/widget", number: 42 }}
          detail={detail}
          onSelect={() => {}}
          sessionAction={{ label: "Create session", onSelect }}
        />
      </WidthTierValue>
    )

    fireEvent.click(screen.getByRole("button", { name: "Create session" }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("routes files locally and submits global pull request actions", async () => {
    const onOpenFiles = vi.fn()
    const onComment = vi.fn(async () => undefined)
    const onClosePr = vi.fn(async () => undefined)
    const onMerge = vi.fn()
    render(
      <WidthTierValue width={1200}>
        <PullRequestInbox
          prs={prs}
          viewerLogin="morgan"
          selected={{ repository: "acme/widget", number: 42 }}
          detail={detail}
          onSelect={() => {}}
          onOpenFiles={onOpenFiles}
          onComment={onComment}
          onClosePr={onClosePr}
          onMerge={onMerge}
          sessionAction={{ label: "Create session", onSelect: () => {} }}
        />
      </WidthTierValue>
    )

    const sessionButton = screen.getByRole("button", { name: "Create session" })
    expect(sessionButton.getAttribute("data-slot")).toBe("button")
    expect(sessionButton.querySelector(".lucide-download")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Files 1" }))
    expect(onOpenFiles).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText("Leave a comment…"), {
      target: { value: "Ship it" }
    })
    fireEvent.click(screen.getByRole("button", { name: "Comment" }))
    await waitFor(() => expect(onComment).toHaveBeenCalledWith("Ship it"))

    const mergeButton = screen.getByRole("button", { name: "Merge pull request" })
    const closeButton = screen.getByRole("button", { name: "Close pull request" })
    expect(mergeButton.compareDocumentPosition(closeButton) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    fireEvent.click(closeButton)
    const closeButtons = screen.getAllByRole("button", { name: "Close pull request" })
    fireEvent.click(closeButtons.at(-1)!)
    await waitFor(() => expect(onClosePr).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole("button", { name: "Merge pull request" }))
    expect(onMerge).toHaveBeenCalledWith("merge")
  })

  it("shows detail request failures instead of a false empty PR state", () => {
    render(
      <WidthTierValue width={1200}>
        <PullRequestInbox prs={prs} viewerLogin="morgan" selected={{ repository: "acme/widget", number: 42 }} detail={null} detailError="GitHub could not load this pull request." onSelect={() => {}} />
      </WidthTierValue>
    )
    expect(screen.getByText("GitHub could not load this pull request.")).toBeTruthy()
    expect(screen.queryByText("No pull request yet for this branch")).toBeNull()
  })

  it("shows a skeleton while loading, then a failed load with Retry that recovers", () => {
    const onRetry = vi.fn()
    const props = { viewerLogin: "morgan", selected: null, detail: null, onSelect: () => {}, onRetry }
    const { container, rerender } = render(<WidthTierValue width={1200}><PullRequestInbox prs={[]} loading {...props} /></WidthTierValue>)
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy()
    rerender(<WidthTierValue width={1200}><PullRequestInbox prs={[]} error="GitHub could not load pull requests." {...props} /></WidthTierValue>)
    expect(container.querySelector("[aria-busy='true']")).toBeNull()
    expect(screen.getByText("GitHub could not load pull requests.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<WidthTierValue width={1200}><PullRequestInbox prs={prs} {...props} /></WidthTierValue>)
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
    expect(screen.getByRole("button", { name: UPDATE_API })).toBeTruthy()
  })

  it("shows an empty state when no pull requests match", () => {
    render(<WidthTierValue width={1200}><PullRequestInbox prs={[]} viewerLogin="morgan" selected={null} detail={null} onSelect={() => {}} /></WidthTierValue>)
    expect(screen.getByText("No pull requests match this view")).toBeTruthy()
  })

  it("offers Clear filters on an empty filtered view, and clearing resets the query", () => {
    const onQueryChange = vi.fn()
    render(<WidthTierValue width={1200}><PullRequestInbox prs={[]} viewerLogin="morgan" selected={null} detail={null} onSelect={() => {}} onQueryChange={onQueryChange} /></WidthTierValue>)
    fireEvent.click(screen.getByRole("radio", { name: "Created" }))
    expect(onQueryChange).toHaveBeenLastCalledWith({ kind: "search", filters: expect.objectContaining({ relationship: "created" }) })
    const empty = screen.getByText("No pull requests match this view").parentElement as HTMLElement
    fireEvent.click(within(empty).getByRole("button", { name: "Clear filters" }))
    expect(onQueryChange).toHaveBeenLastCalledWith({ kind: "search", filters: expect.objectContaining({ relationship: "all" }) })
  })

  it("replaces the list with detail on small screens and returns", () => {
    const onCreateSession = vi.fn()
    render(
      <WidthTierValue width={480}>
        <PullRequestInbox
          prs={prs}
          viewerLogin="morgan"
          selected={{ repository: "acme/widget", number: 42 }}
          detail={detail}
          onSelect={() => {}}
          sessionAction={{ label: "Create session", onSelect: onCreateSession }}
        />
      </WidthTierValue>
    )

    fireEvent.click(screen.getByRole("button", { name: FIX_TOKEN_REFRESH }))
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Create session" }))
    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText("Search pull requests")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByPlaceholderText("Search pull requests")).toBeTruthy()
  })
})
