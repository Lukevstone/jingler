import type { HomePullRequest } from "@jingler/core"

/** The day's frozen review pick, stored per account in localStorage. */
export type DailyPick = {
  readonly date: string
  readonly account: string
  readonly pickedAt: string
  readonly ids: ReadonlyArray<string>
}

export const DAILY_REVIEWS = 3

/** Local calendar date, `YYYY-MM-DD`. */
export const localDate = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

/** Merged/closed PRs authored in the last 7 days are shown; this is the search's `closed:>=` date. */
export const closedSince = (now: Date) => localDate(new Date(now.getTime() - 7 * 86_400_000))

/** Personal requests before team ones, then oldest waiting. */
export const pickReviews = (pool: ReadonlyArray<HomePullRequest>): ReadonlyArray<string> =>
  [...pool]
    .sort((a, b) => Number(b.directRequest) - Number(a.directRequest) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, DAILY_REVIEWS)
    .map((pr) => pr.id)

const NODE_ID = /^[A-Za-z0-9_=+/-]{1,200}$/

/** A stored pick, or null when storage holds anything else (a bad record would block every Home read). */
export const parsePick = (raw: unknown): DailyPick | null => {
  const pick = raw as Partial<Record<keyof DailyPick, unknown>> | null
  if (typeof pick !== "object" || pick === null) return null
  const { date, account, pickedAt, ids } = pick
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    typeof account === "string" && account !== "" &&
    typeof pickedAt === "string" && Number.isFinite(Date.parse(pickedAt)) &&
    Array.isArray(ids) && ids.length <= DAILY_REVIEWS && ids.every((id) => typeof id === "string" && NODE_ID.test(id))
    ? { date, account, pickedAt, ids }
    : null
}

/** Today's pick for this account: the stored one, or a fresh one from the pool. */
export const ensurePick = (
  stored: DailyPick | null,
  account: string,
  pool: ReadonlyArray<HomePullRequest>,
  now: Date
): DailyPick =>
  stored && stored.date === localDate(now) && stored.account === account
    ? stored
    : { date: localDate(now), account, pickedAt: now.toISOString(), ids: pickReviews(pool) }

/** Done once the viewer reviewed after the pick, or the PR merged/closed or no longer resolves. */
export const reviewDone = (pr: HomePullRequest | null, pickedAt: string): boolean =>
  pr === null ||
  pr.state === "merged" ||
  pr.state === "closed" ||
  (pr.viewerReviewedAt !== null && Date.parse(pr.viewerReviewedAt) > Date.parse(pickedAt))

export type PrStatusTone = "neutral" | "green" | "yellow" | "red" | "purple"

/** The one status that matters most for a row: lifecycle, then checks, then review. */
export const prStatus = (pr: HomePullRequest): { readonly label: string; readonly tone: PrStatusTone } => {
  if (pr.state === "merged") return { label: "Merged", tone: "purple" }
  if (pr.state === "closed") return { label: "Closed", tone: "neutral" }
  if (pr.state === "draft") return { label: "Draft", tone: "neutral" }
  if (pr.checks === "fail") return { label: "Checks failing", tone: "red" }
  if (pr.reviewDecision === "changes-requested") return { label: "Changes requested", tone: "red" }
  if (pr.checks === "running" || pr.checks === "pending") return { label: "Checks running", tone: "yellow" }
  if (pr.reviewDecision === "approved") return { label: "Approved", tone: "green" }
  return { label: "Awaiting review", tone: "neutral" }
}

export type TodoReview = { readonly id: string; readonly pr: HomePullRequest | null; readonly done: boolean }

/**
 * Rows for the frozen pick. `picked` is the node read (aligned to `pick.ids`, undefined until
 * it has loaded); until then rows fall back to the pool so the first load renders at once.
 */
export const todoReviews = (
  pick: DailyPick,
  picked: ReadonlyArray<HomePullRequest | null> | undefined,
  pool: ReadonlyArray<HomePullRequest>
): ReadonlyArray<TodoReview> =>
  pick.ids.map((id, index) => {
    if (picked === undefined) {
      const pr = pool.find((candidate) => candidate.id === id) ?? null
      return { id, pr, done: pr !== null && reviewDone(pr, pick.pickedAt) }
    }
    const pr = picked[index] ?? null
    return { id, pr, done: reviewDone(pr, pick.pickedAt) }
  })
