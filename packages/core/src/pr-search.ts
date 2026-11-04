import type { PrSearchFilters, PullRequestListItem } from "./domain.js"

const same = (actual: string, wanted: string) => !wanted || actual.toLowerCase() === wanted.toLowerCase()

/** The inbox filters applied in memory: the GitHub App fallback and the session's directly fetched PRs. */
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
