import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { HomeToday, closedSince, ensurePick, todoReviews, useHomeSectionsOpen, type DailyPick } from "@jingler/ui"
import { rpc } from "./rpc-client.js"
import { githubPollInterval, retryUnlessRateLimited } from "./github-poll.js"

const PICK_KEY = "jingler.home.review-pick"
const POLL_MS = 5 * 60_000

const readPick = (): DailyPick | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(PICK_KEY) ?? "null") as DailyPick | null
    return raw && typeof raw.date === "string" && Array.isArray(raw.ids) ? raw : null
  } catch {
    return null
  }
}

const message = (error: unknown) => (error as { message?: string } | null)?.message ?? "Couldn't load GitHub."

/** Home › To Do + My PRs. Mounted only while Home is on screen, so it polls only then. */
export function HomeTodayPanel({ onOpenAllPrs }: { readonly onOpenAllPrs?: () => void }) {
  const [stored, setStored] = useState(readPick)
  const [open, setOpen] = useHomeSectionsOpen()
  const ids = stored?.ids ?? []
  const query = useQuery({
    queryKey: ["github", "home", ids],
    queryFn: async () => ({ ids, data: await rpc.githubHome({ picked: ids, closedSince: closedSince(new Date()) }) }),
    placeholderData: (previous) => previous,
    refetchInterval: githubPollInterval(POLL_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: retryUnlessRateLimited
  })
  const data = query.data?.data

  // First load of the day (or another account): freeze today's pick from the pool.
  useEffect(() => {
    if (!data?.viewerLogin) return
    const pick = ensurePick(stored, data.viewerLogin, data.reviewPool, new Date())
    if (pick === stored) return
    try { localStorage.setItem(PICK_KEY, JSON.stringify(pick)) } catch { /* private window */ }
    setStored(pick)
  }, [data, stored])

  const reviews = useMemo(() => {
    if (!data || !stored || stored.account !== data.viewerLogin) return undefined
    // Node reads only count when they answered this exact pick.
    const aligned = query.data?.ids.join() === stored.ids.join() && !query.isPlaceholderData
    return todoReviews(stored, aligned ? data.picked : undefined, data.reviewPool)
  }, [data, stored, query.data, query.isPlaceholderData])

  const error = query.isError && !data ? message(query.error) : null
  const retry = () => void query.refetch()
  return (
    <HomeToday
      reviews={{ data: reviews, loading: query.isFetching, error, onRetry: retry }}
      mine={{ data: data ? { prs: data.mine, total: data.mineTotal } : undefined, loading: query.isFetching, error, onRetry: retry }}
      onOpenPr={(url) => void window.jingler.openExternal(url)}
      onOpenAllPrs={onOpenAllPrs}
      open={open}
      onOpenChange={setOpen}
    />
  )
}
