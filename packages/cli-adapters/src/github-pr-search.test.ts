import { describe, expect, it } from "vitest"
import type { PrSearchFilters, PullRequestListItem } from "@jingler/core"
import { buildPrSearchQuery, matchesPrSearch, type TeamScope } from "./github-pr-search.js"

const none: PrSearchFilters = { relationship: "all", repository: "", author: "", label: "", draft: "all", text: "" }
const team = (over: Partial<TeamScope> = {}): TeamScope => ({
  organization: "trigify", slug: "maintainers", queue: "reviews", members: ["iammorganparry", "Lukevstone"], repositories: [], ...over
})

describe("buildPrSearchQuery", () => {
  it("maps each personal relationship to a search qualifier", () => {
    expect(buildPrSearchQuery(none, null)).toBe("is:pr is:open involves:@me sort:updated-desc")
    expect(buildPrSearchQuery({ ...none, relationship: "created" }, null)).toContain("author:@me")
    expect(buildPrSearchQuery({ ...none, relationship: "assigned" }, null)).toContain("assignee:@me")
    expect(buildPrSearchQuery({ ...none, relationship: "review-requested" }, null)).toContain("review-requested:@me")
  })

  it("puts every facet into the query so paging can't hide matches", () => {
    const q = buildPrSearchQuery({ ...none, repository: "acme/widget", author: "jo", label: 'needs "review"', draft: "ready", text: "flaky login" }, null)
    expect(q).toBe('is:pr is:open involves:@me repo:acme/widget author:jo label:"needs review" draft:false flaky login sort:updated-desc')
  })

  it("team reviews include the team and each member, since GitHub requests people", () => {
    expect(buildPrSearchQuery(none, team())).toBe(
      "is:pr is:open org:trigify (team-review-requested:trigify/maintainers OR review-requested:iammorganparry OR review-requested:Lukevstone) sort:updated-desc"
    )
  })

  it("team authored/repositories scope by members or repos, null when empty", () => {
    expect(buildPrSearchQuery(none, team({ queue: "authored" }))).toContain("org:trigify (author:iammorganparry OR author:Lukevstone)")
    expect(buildPrSearchQuery(none, team({ queue: "repositories", repositories: ["trigify/app"] }))).toContain("repo:trigify/app")
    expect(buildPrSearchQuery(none, team({ queue: "repositories" }))).toBeNull()
    expect(buildPrSearchQuery(none, team({ queue: "authored", members: [] }))).toBeNull()
  })

  it("rejects qualifier injection through filters", () => {
    expect(() => buildPrSearchQuery({ ...none, repository: "acme/widget repo:evil/x" }, null)).toThrow()
    expect(() => buildPrSearchQuery({ ...none, author: "jo is:closed" }, null)).toThrow()
    expect(() => buildPrSearchQuery(none, team({ slug: "../x" }))).toThrow()
  })
})

describe("matchesPrSearch", () => {
  const pr = {
    number: 7, title: "Fix API", repository: "acme/widget", author: { login: "jo", avatarUrl: null },
    isDraft: false, labels: [{ name: "bug", color: "f00" }], assignedToViewer: true, reviewRequestedFromViewer: false
  } as unknown as PullRequestListItem

  it("applies the same filters in memory for the App fallback", () => {
    expect(matchesPrSearch(pr, { ...none, relationship: "assigned", label: "BUG", text: "api" }, "me")).toBe(true)
    expect(matchesPrSearch(pr, { ...none, relationship: "created" }, "me")).toBe(false)
    expect(matchesPrSearch(pr, { ...none, draft: "draft" }, "me")).toBe(false)
  })
})
