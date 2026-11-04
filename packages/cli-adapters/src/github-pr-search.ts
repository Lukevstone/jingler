import type { GitHubTeamQueue, PrSearchFilters, PullRequestListItem } from "@jingler/core"
import { GitHubApiError } from "@jingler/core"

export const PR_PAGE_SIZE = 25
/** Under this many GraphQL points left, stop paging until GitHub's reset. */
export const RATE_LIMIT_FLOOR = 200
// ponytail: one OR group per query; split into aliased searches if a team outgrows this.
export const MAX_SCOPE_TERMS = 100

const LOGIN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const REPOSITORY = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\/[a-zA-Z0-9_.-]{1,100}$/
const ORG = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/

const invalid = (message: string) => new GitHubApiError({ reason: "validation", message })

export type TeamScope = {
  readonly organization: string
  readonly slug: string
  readonly queue: GitHubTeamQueue
  readonly members: ReadonlyArray<string>
  readonly repositories: ReadonlyArray<string>
}

const RELATIONSHIP = {
  all: "involves:@me",
  created: "author:@me",
  assigned: "assignee:@me",
  "review-requested": "review-requested:@me"
} as const

const anyOf = (terms: ReadonlyArray<string>) => (terms.length === 1 ? terms[0]! : `(${terms.join(" OR ")})`)

const teamClause = (team: TeamScope): string | null => {
  if (!ORG.test(team.organization) || !ORG.test(team.slug)) throw invalid("Choose a valid GitHub organization team.")
  const members = team.members.filter((login) => LOGIN.test(login)).slice(0, MAX_SCOPE_TERMS)
  if (team.queue === "reviews") {
    return `org:${team.organization} ${anyOf([`team-review-requested:${team.organization}/${team.slug}`, ...members.map((login) => `review-requested:${login}`)])}`
  }
  if (team.queue === "authored") {
    return members.length === 0 ? null : `org:${team.organization} ${anyOf(members.map((login) => `author:${login}`))}`
  }
  const repositories = team.repositories.filter((name) => REPOSITORY.test(name)).slice(0, MAX_SCOPE_TERMS)
  return repositories.length === 0 ? null : anyOf(repositories.map((name) => `repo:${name}`))
}

/**
 * The GitHub search for one inbox view. Every filter is a search qualifier so paging never hides
 * matches; null when the team scope is empty (no members / no team repositories).
 */
export const buildPrSearchQuery = (filters: PrSearchFilters, team: TeamScope | null): string | null => {
  const scope = team === null ? RELATIONSHIP[filters.relationship] : teamClause(team)
  if (scope === null) return null
  const parts = ["is:pr is:open", scope]
  if (filters.repository) {
    if (!REPOSITORY.test(filters.repository)) throw invalid("Choose a valid repository (owner/name).")
    parts.push(`repo:${filters.repository}`)
  }
  if (filters.author) {
    if (!LOGIN.test(filters.author)) throw invalid("Choose a valid GitHub login.")
    parts.push(`author:${filters.author}`)
  }
  const label = filters.label.replace(/["\\]/g, "").trim()
  if (label) parts.push(`label:"${label}"`)
  if (filters.draft !== "all") parts.push(`draft:${filters.draft === "draft"}`)
  const text = filters.text.trim()
  if (text) parts.push(text)
  parts.push("sort:updated-desc")
  return parts.join(" ")
}

const same = (actual: string, wanted: string) => !wanted || actual.toLowerCase() === wanted.toLowerCase()

/** The same filters applied in memory, for the GitHub App fallback that has no search. */
export const matchesPrSearch = (pr: PullRequestListItem, filters: PrSearchFilters, viewerLogin: string): boolean => {
  const relationship = {
    all: true,
    created: pr.author.login.toLowerCase() === viewerLogin.toLowerCase(),
    assigned: pr.assignedToViewer,
    "review-requested": pr.reviewRequestedFromViewer
  }[filters.relationship]
  const text = filters.text.trim().toLowerCase()
  return relationship && same(pr.repository, filters.repository) && same(pr.author.login, filters.author) &&
    (!filters.label || pr.labels.some((label) => same(label.name, filters.label))) &&
    (filters.draft === "all" || pr.isDraft === (filters.draft === "draft")) &&
    (!text || `${pr.title} ${pr.repository} ${pr.author.login} ${pr.number}`.toLowerCase().includes(text))
}
