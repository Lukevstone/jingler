import type { Meta, StoryObj } from "@storybook/react-vite"
import type { HomePullRequest } from "@jingler/core"
import { HomeToday } from "./home-today.js"

const meta = { title: "Composites/Home today", parameters: { layout: "padded" } } satisfies Meta
export default meta
type Story = StoryObj

const noop = () => {}
const pr = (n: number, over: Partial<HomePullRequest> = {}): HomePullRequest => ({
  id: `PR_${n}`, number: n, title: `Tighten the session store #${n}`, url: "", repository: "acme/widget", author: "jo",
  state: "open", checks: "pass", reviewDecision: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  viewerReviewedAt: null, directRequest: false, ...over
})
const load = <T,>(data: T | undefined, error: string | null = null) => ({ data, loading: false, error, onRetry: noop })
const open = { todo: true, mine: true }

export const Populated: Story = {
  render: () => <HomeToday
    reviews={load([
      { id: "PR_1", pr: pr(1), done: true },
      { id: "PR_2", pr: pr(2, { checks: "running" }), done: false },
      { id: "PR_3", pr: null, done: true }
    ])}
    mine={load({ prs: [pr(4, { reviewDecision: "approved" }), pr(5, { checks: "fail" }), pr(6, { state: "merged" })], total: 9 })}
    onOpenPr={noop} onOpenAllPrs={noop} open={open} onOpenChange={noop}
  />
}
export const Empty: Story = {
  render: () => <HomeToday reviews={load([])} mine={load({ prs: [], total: 0 })} onOpenPr={noop} open={open} onOpenChange={noop} />
}
export const Loading: Story = {
  render: () => <HomeToday reviews={load(undefined)} mine={load(undefined)} onOpenPr={noop} open={open} onOpenChange={noop} />
}
export const Failed: Story = {
  render: () => <HomeToday reviews={load(undefined, "GitHub CLI isn't signed in.")} mine={load(undefined, "GitHub CLI isn't signed in.")} onOpenPr={noop} open={open} onOpenChange={noop} />
}
