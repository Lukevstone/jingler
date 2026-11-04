import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { HomeToday, closedSince, ensurePick, localDate, parsePick, todoReviews, useHomeSectionsOpen, type DailyPick } from "@jingler/ui"
import { rpc } from "./rpc-client.js"
import { githubPollInterval, retryUnlessRateLimited } from "./github-poll.js"

const PICK_KEY = "jingler.home.review-pick"
const ACCOUNT_KEY = `${PICK_KEY}.account`
const POLL_MS = 5 * 60_000

const readStorage = (key: string) => {
  try { return localStorage.getItem(key) } catch { return null }
}
const writeStorage = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch { /* private window */ }
}

/** One pick per account, so switching gh accounts mid-day keeps each account's frozen pick. */
const readPick = (account: string | null): DailyPick | null => {
  if (!account) return null
  try { return parsePick(JSON.parse(readStorage(`${PICK_KEY}.${account}`) ?? "null")) } catch { return null }
}

/** Local date, re-read each minute so a Home left open rolls over at midnight. */
function useToday() {
  const [today, setToday] = useState(() => localDate(new Date()))
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate(new Date())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

const message = (error: unknown) => (error as { message?: string } | null)?.message ?? "Couldn't load GitHub."

/** Home › To Do + My PRs. Mounted only while Home is on screen, so it polls only then. */
export function HomeTodayPanel() {
  const today = useToday()
  const [stored, setStored] = useState(() => readPick(readStorage(ACCOUNT_KEY)))
  const [open, setOpen] = useHomeSectionsOpen()
  const ids = stored?.date === today ? stored.ids : []
  const query = useQuery({
    queryKey: ["github", "home", today, ids],
    queryFn: async () => ({ date: today, ids, data: await rpc.githubHome({ picked: ids, closedSince: closedSince(new Date()) }) }),
    placeholderData: (previous) => previous,
    refetchInterval: githubPollInterval(POLL_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: retryUnlessRateLimited
  })
  const data = query.data?.data

  // Freeze today's pick only from a response fetched today, never yesterday's placeholder.
  useEffect(() => {
    const fresh = query.data
    if (!fresh || query.isPlaceholderData || fresh.date !== today || !fresh.data.viewerLogin) return
    const account = fresh.data.viewerLogin
    const current = stored?.account === account ? stored : readPick(account)
    const pick = ensurePick(current, account, fresh.data.reviewPool, new Date())
    if (pick === stored) return
    if (pick !== current) writeStorage(`${PICK_KEY}.${account}`, JSON.stringify(pick))
    writeStorage(ACCOUNT_KEY, account)
    setStored(pick)
  }, [query.data, query.isPlaceholderData, stored, today])

  const reviews = useMemo(() => {
    if (!data || !stored || stored.account !== data.viewerLogin || stored.date !== today) return undefined
    // Node reads only count when they answered this exact pick.
    const aligned = query.data?.ids.join() === stored.ids.join() && !query.isPlaceholderData
    return todoReviews(stored, aligned ? data.picked : undefined, data.reviewPool)
  }, [data, stored, today, query.data, query.isPlaceholderData])

  // Shown above cached rows too, so a stalled refresh never looks current.
  const error = query.isError ? message(query.error) : null
  const retry = () => void query.refetch()
  return (
    <HomeToday
      reviews={{ data: reviews, loading: query.isFetching, error, onRetry: retry }}
      mine={{ data: data ? { prs: data.mine, total: data.mineTotal } : undefined, loading: query.isFetching, error, onRetry: retry }}
      onOpenPr={(url) => void window.jingler.openExternal(url)}
      open={open}
      onOpenChange={setOpen}
    />
  )
}
