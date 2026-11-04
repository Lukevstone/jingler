# Home "Today" view — agreed scope

Grilling complete. No product code changed yet.

## Operator decisions

| Topic | Decision |
| --- | --- |
| My PRs | `author:@me` across all repos. Open ones plus anything merged/closed in the last 7 days, newest update first. Show 3, then "+N more" opens the PR inbox. Each row shows status: draft, checks, review decision, merged/closed. |
| Review pool | `review-requested:@me` plus `team-review-requested:ORG/SLUG` for every team from `GET /user/teams`. Own PRs and drafts left out. |
| Daily pick | Picked on the first Home load each day, then frozen for the day (localStorage, keyed by date + account). Personal requests before team ones, then oldest waiting. No backfill. Shows "x of 3 done today". |
| Done rule | You've submitted any review (approve / changes / comment) with `submittedAt` after the pick time, read from `latestReviews`, or the PR is merged or closed. |
| Plan steps | Save `planFilePath` on the session when it changes. Home parses `- [ ]` steps from that file for non-archived sessions, grouped by session title, first 3 plus "+N more". Clicking one opens that session's Plan view. Sessions with no plan file or no open steps are skipped. |
| Slack brief | Otto-style: a daily routine runs a read-only agent using an operator-configured Slack MCP. It returns a fenced JSON block (`title, reason, channel, link, needsYou`), and Home shows the latest result. No Slack code in Jingler. No Slack MCP configured → show a "Connect Slack MCP" hint and skip the run. |
| Brief routine | You pick a host project once; the run uses it only as a working folder (no edits). A per-routine allowlist auto-approves only the Slack MCP read tools. Runs every 24h, first run at 07:30 local. If it still hits an approval prompt, Home shows "Brief needs you" with a link to the session. |
| Layout | Greeting → composer → Needs you / Running → 2-col grid [To Do \| My PRs] → Slack brief full width → import card. Stacks below ~640px. Each section collapsible, saved in localStorage. |
| Refresh | Refetch when Home is shown or the window gets focus, plus `githubPollInterval(5 * 60_000)` while visible (`refetchIntervalInBackground: false`). Manual Refresh per section. Two GraphQL searches per refresh; the done-check rides along in the same query. |

## Delivery — 3 PRs

- [ ] **PR 1 — My PRs + To Do reviews (~1 day).** New `gh` GraphQL queries in `packages/cli-adapters/src/github-cli.ts`, typed RPC (`packages/core/src/domain.ts`, `packages/contracts`, `apps/desktop/src/main/rpc.ts`), daily-pick + done-rule pure model with tests, 2-col layout in `packages/ui/src/screens/empty-conversation.tsx`, e2e extending `home.spec.ts` with `fake-github.ts`.
- [ ] **PR 2 — Plan steps in To Do (~0.5 day).** Save `planFilePath` on the session, a main-process reader that parses open `- [ ]` steps, To Do group UI, tests for the parser and the restart case.
- [ ] **PR 3 — Slack brief (~1.5 days).** Routine MCP read-tool allowlist (`packages/core/src/routines.ts` + approval path), brief prompt, JSON result parser with tests, brief card plus the "Connect Slack MCP" and "Brief needs you" states.

## Defaults taken (no question needed)

- `gh` not authenticated → PR sections show the existing GitHub connect state, not an empty list.
- Partial team-search failures show as "some teams unavailable · Retry", never as a complete list.
- Brief JSON that fails to parse → show the run's session link with "Brief couldn't be read".
