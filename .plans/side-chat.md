# Side Chat

Ask quick questions about a session without touching it. Works like Claude Code's `/btw`, with follow-ups in a dock. It sees the full session context, has **no tools**, is never written to the session or journal, runs alongside a live turn without interrupting it, and is wiped when the dock closes. Supports Claude, Codex and Pi.

Research: Claude Code `/btw` docs (code.claude.com/docs/en/interactive-mode#side-questions-with-btw); `claude --help` (`--fork-session`, `--no-session-persistence`, `--tools ""`); Codex app-server `ThreadForkParams` (`ephemeral`, `sandbox`, `approvalPolicy`).

Approved inline by the operator (plan mode blocked writing this file).

## Runtime side-chat turns <!-- id: runtime -->

**Deliverable:** each runtime can run one side-chat turn that forks the chat's context, has no tools and persists nothing.

**User story:** As an operator, I can ask about the current session and get an answer built from its full context, without the main thread changing.

**Approach:** add `"side-chat"` to `AgentRole`. A side-chat spec uses `mode: "read-only"`, takes `continuation` from the main chat, and puts the earlier side-thread Q&A in `priorMessages`. Each turn re-forks the main chat.

- [x] Add `"side-chat"` to `AgentRole`, fix exhaustive switches
- [x] Claude: `--resume <id> --fork-session --no-session-persistence --tools ""`, no `--mcp-config`
- [x] Codex: `thread/fork` with `ephemeral: true`, read-only sandbox, `approvalPolicy: "never"`
- [x] Pi: in-memory `SessionManager`, `tools: []`
- [x] Side-chat prompt layer

**Technical explanation:** forking leaves the main session unchanged; `--no-session-persistence` and Codex `ephemeral` write no new session file.

**Acceptance:** runtime tests for Claude args, Codex fork request, Pi no-file/no-tools.

**Definition of Done:** runtime tests + `pnpm typecheck` green.

**Files:** `packages/core/src/runtime/agent-runtime.ts`, `claude-agent-runtime.ts`, `codex/runtime.ts`, `pi-session-factory.ts`, tests.

## Side-chat RPC <!-- id: rpc -->

**Deliverable:** streaming `SideChat.ask` RPC; never writes session state.

**User story:** As the renderer, I send `{ sessionId, chatId, thread, prompt }` and get streamed assistant events; unsubscribing cancels.

**Approach:** generalise `read-only-role.ts` into a shared spec builder with a streaming side-chat caller.

- [x] `SideChat.ask` contract
- [x] `runSideChat` in `read-only-role.ts`
- [x] Handler in `apps/desktop/src/main/rpc.ts`

**Acceptance:** `read-only-role.test.ts` checks the side-chat spec; title runs unchanged.

**Definition of Done:** unit tests green.

**Files:** `packages/contracts/src/index.ts`, `read-only-role.ts`, `apps/desktop/src/main/rpc.ts`, test.

## Side-chat dock UI <!-- id: ui -->

**Deliverable:** right-hand "Side chat" dock matching the screenshot.

**User story:** As an operator, I open Side chat, ask and follow up while the agent works; closing wipes the thread.

**Approach:** `side-chat-machine.ts` (closed → open.idle ⇄ open.streaming) + `SideChatPanel` composite in `packages/ui`.

- [x] `SideChatPanel` + story + test + `COMPONENTS.md` row
- [x] `side-chat-machine.ts` + test
- [x] `use-side-chat.ts`, mount in `conversation-pane.tsx`, header toggle
- [x] Hide toggle when chat has no runtime identity

**Acceptance:** machine tests; story parity with screenshot.

**Definition of Done:** tests green; `--sb-*` tokens only.

**Files:** `packages/ui/src/composites/side-chat-panel.tsx`, `COMPONENTS.md`, `side-chat-machine.ts`, `use-side-chat.ts`, `conversation-pane.tsx`.

## End-to-end + release note <!-- id: e2e -->

**Deliverable:** Playwright `_electron` spec + changeset.

**User story:** As a maintainer, I know side chat answers, follows up, leaves the main transcript untouched and clears on close.

- [x] `apps/desktop/e2e/side-chat.spec.ts`
- [x] `affected-map.json` entry
- [x] Minor changeset

**Acceptance:** `e2e:affected`, lint, typecheck, test green.

**Definition of Done:** all checks green locally.

**Files:** `apps/desktop/e2e/side-chat.spec.ts`, `affected-map.json`, `.changeset/*.md`.

## Risks
- Codex has no clean zero-tools switch; read-only sandbox + `never` approvals + instructions are the closest.
- Pi in-memory `SessionManager` API to confirm against the installed version.
