# Home "Today" view — agreed scope

Grilling complete. No product code changed yet.

## Operator decisions

| Topic | Decision |
| --- | --- |
| My PRs | `author:@me` across all repos. Open ones plus anything merged/closed in the last 7 days, newest update first. Show 3, then "+N more" opens the PR inbox. Each row shows status: draft, checks, review decision, merged/closed. |
| Review pool | `review-requested:@me` plus `team-review-requested:ORG/SLUG` for every team from `GET /user/teams`. Own PRs and drafts left out. |
| Daily pick | Picked on the first Home load each day, then frozen for the day (localStorage, keyed by date + account). Personal requests before team ones, then oldest waiting. No backfill. Stored pick = PR node IDs + pick time. Progress is "x of N done today", where N is the number actually picked (0–3). An empty pool on first load shows "No reviews waiting". If later loads find new requests that day, they wait for tomorrow's pick, because the pick is frozen. |
| Done rule | You've submitted any review (approve / changes / comment) with `submittedAt` after the pick time, or the PR is merged or closed. Checked by fetching the stored picked node IDs directly (`nodes(ids:[…]){... on PullRequest{state latestReviews(first:20){nodes{author{login} submittedAt}}}}`), not from search results: reviewing, merging or closing a PR drops it from the search, which is exactly the change we need to see. |
| Plan steps | Save `planFilePath` on the session when it changes. Home parses `- [ ]` steps from that file for non-archived sessions, grouped by session title, first 3 plus "+N more". Clicking one opens that session's Plan view. Sessions with no plan file or no open steps are skipped. |
| Slack brief | Otto-style: a daily routine runs a read-only agent using an operator-configured Slack MCP. It returns a fenced JSON block (`title, reason, channel, link, needsYou`), and Home shows the latest result. No Slack code in Jingler. No Slack MCP configured → show a "Connect Slack MCP" hint and skip the run. |
| Brief routine | You pick a host project once; the run uses it only as a working folder (no edits). A per-routine allowlist auto-approves only the Slack MCP read tools. Runs every 24h, first run at 07:30 local. If it still hits an approval prompt, Home shows "Brief needs you" with a link to the session. |
| Layout | Greeting → composer → Needs you / Running → 2-col grid [To Do \| My PRs] → Slack brief full width → import card. Stacks below ~640px. Each section collapsible, saved in localStorage. |
| Refresh | Refetch when Home is shown or the window gets focus, plus `githubPollInterval(5 * 60_000)` while visible (`refetchIntervalInBackground: false`). Manual Refresh per section. Each refresh makes two GraphQL searches (My PRs, review pool) plus one `nodes(ids:)` read for the frozen pick. Skipped only when the pick is empty. |

## Delivery — 3 PRs

- [ ] **PR 1 — My PRs + To Do reviews (~1 day).** New `gh` GraphQL queries in `packages/cli-adapters/src/github-cli.ts`, typed RPC (`packages/core/src/domain.ts`, `packages/contracts`, `apps/desktop/src/main/rpc.ts`), daily-pick + done-rule pure model with tests, 2-col layout in `packages/ui/src/screens/empty-conversation.tsx`, e2e extending `home.spec.ts` with `fake-github.ts`.
  - [ ] Home data path (`Github.home`, one GraphQL call) + daily-pick model with tests.
  - [ ] Home UI: `HomeToday` composite + renderer panel slot.
  - [ ] PR list: team "Requested reviews" = `team-review-requested:org/slug` + `review-requested:<member>` per member (trigify/maintainers has 0 team requests on GitHub).
  - [ ] PR list: repo filter options loaded async from `gh api user/repos`; selection adds `repo:owner/name` to the GitHub search.
  - [ ] PR list: GraphQL cursor pages of 25 via `useInfiniteQuery`, load on scroll, personal + team. Replaces the REST team search engine.
  - [ ] PR list: every filter goes into the GitHub query: relationship chips → `involves|author|assignee|review-requested:@me`, `repo:`, `author:`, `label:"…"`, `draft:`, search text (debounced 400ms). Team reviews = one `OR` query (aliased chunks above 5 members). Results past 1,000 → "Narrow the filters to see more".
  - [ ] PR list: "This session" fetches linked PRs directly (`repository{pullRequest(number:)}` aliases, one call).
  - [ ] PR list: Author/Label = type-ahead with suggestions from loaded rows; typed value applied as is.
  - [ ] Rate limits: every page reads `rateLimit{remaining resetAt}`; under 200 left, trip the graphql `ghGate` bucket until `resetAt` and show "GitHub rate limit, resumes at HH:MM". Pages load only when the scroll sentinel comes into view; 60s cache.
- [ ] **PR 2 — Plan steps in To Do (~0.5 day).** Save `planFilePath` on the session, a main-process reader that parses open `- [ ]` steps, To Do group UI, tests for the parser and the restart case.
- [ ] **PR 3 — Slack brief (~1.5 days).** Routine MCP read-tool allowlist (`packages/core/src/routines.ts` + approval path), brief prompt, JSON result parser with tests, brief card plus the "Connect Slack MCP" and "Brief needs you" states.

## Defaults taken (no question needed)

- `gh` not authenticated → PR sections show the existing GitHub connect state, not an empty list.
- Partial team-search failures show as "some teams unavailable · Retry", never as a complete list.
- Brief JSON that fails to parse → show the run's session link with "Brief couldn't be read".
