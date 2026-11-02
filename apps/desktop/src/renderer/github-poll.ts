/** react-query polling that respects GitHub's rate limits instead of retrying on a timer. */
type PolledQuery = { readonly state: { readonly error: unknown } }

/** ms until a rate-limited error's `retryAt`, or null when the error isn't a rate limit. */
export const rateLimitWaitMs = (error: unknown, now = Date.now()): number | null => {
  if (error === null || typeof error !== "object") return null
  const { reason, retryAt } = error as { reason?: unknown; retryAt?: unknown }
  if (reason !== "rate-limited") return null
  const at = typeof retryAt === "string" ? Date.parse(retryAt) : Number.NaN
  return Number.isFinite(at) ? Math.max(at - now, 1_000) : 60_000
}

/** Poll every `baseMs`, but after a rate limit wait until GitHub says we may retry. */
export const githubPollInterval = (baseMs: number) => (query: PolledQuery): number =>
  Math.max(baseMs, rateLimitWaitMs(query.state.error) ?? 0)

/** react-query's own retries would hammer a limited API; only retry other failures. */
export const retryUnlessRateLimited = (failureCount: number, error: unknown): boolean =>
  rateLimitWaitMs(error) === null && failureCount < 3
