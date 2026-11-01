import { basename } from "node:path"
import { checkoutsOf, hasNoRepo, reduceCheckouts } from "@jingler/core"
import { Effect } from "effect"
import { gitLine } from "./command.js"
import { SessionStore } from "./sessions.js"
import { parseGithubSlug } from "./workspace.js"

/**
 * An Auto session whose scratch folder the agent turned into a real repo (clone,
 * or `git remote add origin`) without `switch_checkout`: fill in the placeholder
 * checkout from the folder so the UI shows the repo. The scratch folder is
 * always `git init`ed, so an `origin` remote is the signal. True when adopted.
 */
/** The lone Auto placeholder checkout, if the session still has nothing else. */
const placeholderOf = (session: Parameters<typeof checkoutsOf>[0]) => {
  const all = checkoutsOf(session)
  const only = all[0]
  return all.length === 1 && only !== undefined && hasNoRepo(only) && only.worktreePath !== undefined ? only : null
}

export const adoptScratchRepo = <E, R>(
  sessionId: string,
  register: (path: string, name: string) => Effect.Effect<{ readonly id: string }, E, R>
) =>
  Effect.gen(function* () {
    const placeholder = placeholderOf(yield* SessionStore.get(sessionId))
    const dir = placeholder?.worktreePath
    if (placeholder === null || dir === undefined) return false
    const remoteUrl = yield* gitLine(dir, "remote", "get-url", "origin")
    if (remoteUrl === null) return false
    const slug = parseGithubSlug(remoteUrl)
    const name = slug?.split("/")[1] ?? basename(dir)
    const branch = (yield* gitLine(dir, "branch", "--show-current")) ?? placeholder.branch
    const project = yield* register(dir, name)
    let adopted = false
    // Re-check against the stored session: a checkout attached meanwhile wins and adoption is skipped.
    yield* SessionStore.modifyCheckouts(sessionId, (current) => {
      const still = placeholderOf(current)
      if (still === null || still.id !== placeholder.id || still.worktreePath !== dir) return null
      adopted = true
      return reduceCheckouts(current, {
        type: "update",
        checkoutId: still.id,
        patch: { repo: name, repoPath: dir, branch, projectId: project.id, ...(slug === null ? {} : { githubSlug: slug }) }
      })
    })
    return adopted
  })
