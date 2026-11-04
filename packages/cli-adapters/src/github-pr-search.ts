import type { GitHubTeamQueue, PrSearchFilters } from "@jingler/core"
export { matchesPrSearch } from "@jingler/core"
import { GitHubApiError } from "@jingler/core"

export const PR_PAGE_SIZE = 25
/** Under this many GraphQL points left, stop paging until GitHub's reset. */
export const RATE_LIMIT_FLOOR = 200
// ISSUE_ADVANCED took a 300-term OR group live (Nov 2026); beyond that we warn instead of guessing.
// ponytail: one OR group per query; split into aliased searches if a team outgrows this.
export const MAX_SCOPE_TERMS = 300

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
  // GitHub search documents no escape for `"` inside a quoted value, so those characters are dropped.
  const label = filters.label.replace(/["\\]/g, "").trim()
  if (label) parts.push(`label:"${label}"`)
  if (filters.draft !== "all") parts.push(`draft:${filters.draft === "draft"}`)
  const text = filters.text.trim()
  if (text) parts.push(text)
  parts.push("sort:updated-desc")
  return parts.join(" ")
}

/** A warning when a team scope is too big for one search, so a cut-off queue never looks complete. */
export const scopeWarning = (team: TeamScope): string | null => {
  const count = team.queue === "repositories" ? team.repositories.length : team.members.length
  return count > MAX_SCOPE_TERMS
    ? `This team has ${count} ${team.queue === "repositories" ? "repositories" : "members"}; only the first ${MAX_SCOPE_TERMS} are searched.`
    : null
}
