import { useCallback, useRef, useState } from "react"
import { useMachine } from "@xstate/react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { activeCheckoutOf } from "@jingler/core"
import type {
  PrMergeMethod,
  Project,
  PullRequestListItem,
  PullRequest,
  Repo,
  ReviewComment,
  Session,
  GitHubTeamQueue
} from "@jingler/core"
import { rpc } from "./rpc-client.js"
import { pullRequestInboxMachine } from "./pull-request-inbox-machine.js"
import { retryUnlessRateLimited } from "./github-poll.js"
import type { PullRequestInboxQuery } from "@jingler/ui"

const NO_FILTERS = { relationship: "all", repository: "", author: "", label: "", draft: "all", text: "" } as const
const DEFAULT_QUERY: PullRequestInboxQuery = { kind: "search", filters: NO_FILTERS }

/** A rate limit names when paging resumes; everything else keeps its own message. */
const listMessage = (error: unknown): string | null => {
  const failure = error as { reason?: string; retryAt?: string; message?: string } | null
  if (failure?.reason !== "rate-limited") return failure?.message ?? null
  return failure.retryAt
    ? `GitHub rate limit, resumes at ${new Date(failure.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "GitHub rate limit reached. Try again shortly."
}

export function pullRequestSessionTarget(
  pr: PullRequestListItem,
  repos: ReadonlyArray<Repo>,
  projects: ReadonlyArray<Project>,
  sessions: ReadonlyArray<Session>
): { readonly project: Project | null; readonly session: Session | null } {
  const repo = repos.find((candidate) => candidate.githubSlug === pr.repository)
  if (!repo) return { project: null, session: null }
  const project = projects.find(
    (candidate) => candidate.path === repo.path && candidate.availability === "available"
  ) ?? null
  return {
    project,
    session: sessions.find(
      (candidate) =>
        activeCheckoutOf(candidate).prNumber === pr.number &&
        (activeCheckoutOf(candidate).repoPath === repo.path || activeCheckoutOf(candidate).projectId === project?.id)
    ) ?? null
  }
}

const inboxQueryIdentity = (
  account: { id: string; login: string } | null,
  team: { organization: string; slug: string } | undefined,
  selected: PullRequestListItem | null
) => ({
  accountId: account?.id, viewerLogin: account?.login,
  organization: team?.organization, teamSlug: team?.slug,
  repository: selected?.repository, number: selected?.number,
})

export const pullRequestInboxViewerLogin = (teamMode: boolean, ready: boolean, login: string | undefined) =>
  teamMode && ready ? login : undefined

const teamPrTarget = (selected: PullRequestListItem | null, account: { id: string } | null) =>
  selected && account ? { accountId: account.id, repository: selected.repository, number: selected.number } : null

const samePullRequest = (a: PullRequestListItem | null, b: PullRequestListItem | null) =>
  a?.repository === b?.repository && a?.number === b?.number

type PersonalIdentityPlaceholder = { accountId: string; selected: PullRequestListItem | null; data: PullRequest | null | undefined }

const preparePersonalIdentityPlaceholder = (
  current: PersonalIdentityPlaceholder | null, accountId: string | undefined,
  teamMode: boolean, selected: PullRequestListItem | null
): PersonalIdentityPlaceholder | null => {
  const placeholder = current ?? (accountId !== undefined ? { accountId, selected: teamMode ? null : selected, data: undefined } : null)
  // Only the selection mounted before first identity may bridge unknown/App data.
  if (placeholder && (teamMode || !samePullRequest(selected, placeholder.selected) || accountId !== placeholder.accountId)) {
    placeholder.selected = null
    placeholder.data = undefined
  }
  return placeholder
}

const personalDetailData = (placeholder: PersonalIdentityPlaceholder | null, data: PullRequest | null | undefined, isPlaceholder: boolean) => {
  // Query drops placeholderData on error; keep the display-only bridge until a verified read.
  if (placeholder && data !== undefined && !isPlaceholder) placeholder.data = undefined
  return data ?? placeholder?.data ?? null
}

type ListInput = {
  readonly accountId: string | undefined
  readonly organization: string | undefined
  readonly teamSlug: string | undefined
  readonly teamInput: { accountId: string; organization: string; teamSlug: string; queue: GitHubTeamQueue } | null
  readonly teamMode: boolean
  readonly ready: boolean
  readonly revision: number
  readonly refreshDiscovery: boolean
}

/** The inbox list: paged search, the session's linked PRs, and the background repository list. */
function usePullRequestList(input: ListInput) {
  const { teamInput, teamMode, ready } = input
  const [inboxQuery, setInboxQuery] = useState<PullRequestInboxQuery>(DEFAULT_QUERY)
  const search = inboxQuery.kind === "search" ? inboxQuery.filters : null
  // One 25-row page per scroll; filters are search qualifiers, so later pages never hide matches.
  const list = useInfiniteQuery({
    queryKey: ["github", "pr-inbox", "list", input.accountId, input.organization, input.teamSlug, teamInput?.queue ?? null, search],
    queryFn: ({ pageParam }) => rpc.githubPrSearch({
      filters: search ?? NO_FILTERS, team: teamInput, after: pageParam,
      refresh: pageParam === null && teamMode && input.refreshDiscovery,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.hasNextPage ? last.endCursor ?? undefined : undefined,
    enabled: search !== null && (!teamMode || ready && teamInput !== null),
    staleTime: 60_000,
    retry: retryUnlessRateLimited,
    // Past staleTime, focus re-reads the loaded pages; rows stay until fresh ones land.
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
  })
  const sessionKeys = inboxQuery.kind === "session" ? inboxQuery.keys : null
  const sessionList = useQuery({
    queryKey: ["github", "pr-inbox", "session", input.accountId, sessionKeys],
    queryFn: () => rpc.githubPrsByKey(sessionKeys ?? []),
    enabled: sessionKeys !== null,
    staleTime: 60_000,
    retry: retryUnlessRateLimited,
  })
  const repositories = useQuery({
    queryKey: ["github", "repositories", input.accountId],
    queryFn: rpc.githubRepositories,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const activeList = sessionKeys !== null ? sessionList : list
  return {
    // A failed or running team discovery must not show the last team's rows.
    ...listView(sessionKeys !== null ? sessionList.data ?? [] : null, teamMode && !ready ? [] : list.data?.pages ?? [], activeList.error),
    pending: activeList.isPending,
    hasMore: sessionKeys === null && hasNextPage,
    loadingMore: isFetchingNextPage,
    loadMoreError: list.isFetchNextPageError ? listMessage(list.error) : null,
    loadMore,
    setQuery: setInboxQuery,
    repositoryOptions: repositories.data?.map((repository) => repository.fullName) ?? [],
  }
}

/** Rows, total and warnings for either the session's linked PRs (`session`) or the loaded search pages. */
const listView = (
  session: ReadonlyArray<PullRequestListItem> | null,
  pages: ReadonlyArray<{ prs: ReadonlyArray<PullRequestListItem>; total: number; warnings: ReadonlyArray<string> }>,
  error: unknown
) => {
  // Sorting by updated time can shift a row across a page boundary; keep the first copy.
  const rows = [...new Map((session ?? pages.flatMap((page) => page.prs))
    .map((pr) => [`${pr.repository.toLowerCase()}#${pr.number}`, pr])).values()]
  const listError = listMessage(error)
  const warnings = [...new Set([
    ...(session === null ? pages.flatMap((page) => page.warnings) : []),
    ...(listError !== null && rows.length > 0 ? [listError] : []),
  ])]
  return { rows, listError, warnings, total: session !== null ? rows.length : pages[0]?.total ?? 0 }
}

export function usePullRequestInbox(_connected: boolean) {
  const [state, send] = useMachine(pullRequestInboxMachine, { input: { discover: rpc.githubTeams } })
  const { account, teams, teamId, queue, selected, revision, discoveryError } = state.context
  const team = teams.find((candidate) => candidate.id === teamId)
  const identity = inboxQueryIdentity(account, team, selected)
  const teamMode = teamId !== null
  const ready = state.matches("ready")
  const queryClient = useQueryClient()
  const listState = usePullRequestList({
    accountId: identity.accountId, organization: identity.organization, teamSlug: identity.teamSlug,
    teamInput: teamMode && account && team ? { accountId: account.id, organization: team.organization, teamSlug: team.slug, queue } : null,
    teamMode, ready, revision, refreshDiscovery: state.context.refreshDiscovery,
  })
  const { rows, listError } = listState
  const personalIdentityPlaceholder = useRef<PersonalIdentityPlaceholder | null>(null)
  const placeholder = preparePersonalIdentityPlaceholder(personalIdentityPlaceholder.current, identity.accountId, teamMode, selected)
  personalIdentityPlaceholder.current = placeholder
  const detail = useQuery({
    queryKey: ["github", "pr-inbox", "detail", teamMode ? "team-cli" : "personal", identity.accountId, identity.repository, identity.number],
    queryFn: () => selected
      ? teamMode && account
        ? rpc.githubTeamPr({ accountId: account.id, repository: selected.repository, number: selected.number })
        : rpc.githubPrBySlug(selected.repository, selected.number)
      : null,
    // First CLI identity may arrive after a Personal/App detail read. Keep its mounted
    // composer while re-reading, without copying unverified data into the known cache.
    placeholderData: (previous, previousQuery) => {
      if (previous !== undefined && !teamMode && account !== null && selected !== null &&
          placeholder?.accountId === account.id && samePullRequest(placeholder.selected, selected) &&
          previousQuery?.queryKey[3] === "personal" && previousQuery.queryKey[4] === undefined &&
          previousQuery.queryKey[5] === selected.repository && previousQuery.queryKey[6] === selected.number) {
        placeholder.data = previous
        return previous
      }
      return undefined
    },
    enabled: selected !== null && (!teamMode || ready),
    retry: teamMode ? false : undefined,
  })
  const detailData = personalDetailData(placeholder, detail.data, detail.isPlaceholderData)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["github", "pr-inbox"] })
  // Focus/visibility share their read; an explicit refresh supersedes an older one.
  const discover = useCallback((cancelRefetch = false) => {
    void queryClient.invalidateQueries({ queryKey: ["github", "pr-inbox", "detail"] }, { cancelRefetch })
    // Only an explicit Refresh re-reads the list; it keeps the loaded rows until fresh ones land.
    if (cancelRefetch) {
      void queryClient.invalidateQueries({ queryKey: ["github", "pr-inbox", "list"] })
      void queryClient.invalidateQueries({ queryKey: ["github", "pr-inbox", "session"] })
    }
    send({ type: "DISCOVER" })
  }, [queryClient, send])
  const target = teamPrTarget(selected, ready ? account : null)
  const commentMutation = useMutation({
    mutationFn: (body: string) => selected
      ? teamMode
        ? target ? rpc.githubTeamComment({ ...target, body }) : Promise.reject(new Error("Refresh teams first."))
        : rpc.githubCommentBySlug(selected.repository, selected.number, body)
      : Promise.reject(new Error("Select a pull request first.")),
    onSuccess: refresh,
  })
  const closeMutation = useMutation({
    mutationFn: () => selected
      ? teamMode
        ? target ? rpc.githubTeamClose(target) : Promise.reject(new Error("Refresh teams first."))
        : rpc.githubCloseBySlug(selected.repository, selected.number)
      : Promise.reject(new Error("Select a pull request first.")),
    onSuccess: refresh,
  })
  const mergeMutation = useMutation({
    mutationFn: (method: PrMergeMethod) => selected
      ? teamMode
        ? target ? rpc.githubTeamMerge({ ...target, method }) : Promise.reject(new Error("Refresh teams first."))
        : rpc.githubMergeBySlug(selected.repository, selected.number, method)
      : Promise.reject(new Error("Select a pull request first.")),
    onSuccess: refresh,
  })
  const inlineReviewMutation = useMutation({
    mutationFn: (input: { body: string; comments: ReadonlyArray<ReviewComment> }) => selected && !teamMode
      ? rpc.githubSubmitReviewBySlug(selected.repository, selected.number, input.comments, input.body)
      : Promise.reject(new Error("Inline comments need a selected pull request.")),
    onSuccess: refresh,
  })
  const resetActionErrors = () => {
    commentMutation.reset()
    closeMutation.reset()
    mergeMutation.reset()
  }
  const message = (error: unknown) => (error as { message?: string } | null)?.message ?? null

  const listLoading = () => {
    if (teamMode) return state.matches("discovering") || ready && listState.pending
    return listState.pending
  }

  return {
    prs: rows,
    total: listState.total,
    hasMore: listState.hasMore,
    loadingMore: listState.loadingMore,
    loadMore: listState.loadMore,
    loadMoreError: listState.loadMoreError,
    setQuery: listState.setQuery,
    repositoryOptions: listState.repositoryOptions,
    viewerLogin: pullRequestInboxViewerLogin(teamMode, ready, identity.viewerLogin),
    cliAccountId: teamMode ? identity.accountId : undefined,
    teams,
    teamId,
    queue,
    selectTeam: (id: string | null) => { resetActionErrors(); send({ type: "TEAM", teamId: id }) },
    selectQueue: (next: GitHubTeamQueue) => { resetActionErrors(); send({ type: "QUEUE", queue: next }) },
    discover,
    refreshInbox: () => discover(true),
    discovering: state.matches("discovering"),
    discoveryError,
    warnings: listState.warnings,
    selected,
    select: (pr: PullRequestListItem) => { resetActionErrors(); send({ type: "SELECT", pr }) },
    detail: detailData,
    loading: listLoading(),
    detailLoading: detail.isPending && selected !== null,
    detailError: message(detail.error),
    submitInlineReview: teamMode ? undefined : (input: { body: string; comments: ReadonlyArray<ReviewComment> }) => { resetActionErrors(); return inlineReviewMutation.mutateAsync(input).then(() => undefined) },
    comment: (body: string) => { resetActionErrors(); return commentMutation.mutateAsync(body) },
    close: () => { resetActionErrors(); return closeMutation.mutateAsync() },
    merge: (method: PrMergeMethod) => { resetActionErrors(); return mergeMutation.mutateAsync(method) },
    closing: closeMutation.isPending,
    closeError: message(closeMutation.error),
    merging: mergeMutation.isPending,
    mergeError: message(mergeMutation.error),
    error: (rows.length > 0 ? null : listError) ?? (teamMode ? discoveryError : null),
  }
}
