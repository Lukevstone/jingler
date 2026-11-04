/** Atomic fixed-window counters backing the bug-report endpoint's shared rate limit. */
import { lt, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database.js"
import { bugReportRateLimit } from "../schema.js"

export class BugReportRateRepository extends Effect.Service<BugReportRateRepository>()(
  "@jingler/server/BugReportRateRepository",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const database = yield* Database
      return {
        /** Count one hit for `key` in `window` and return the new total; old windows are pruned as new ones start. */
        hit: (key: string, window: number) =>
          database.run("BugReportRateRepository.hit", async (db) => {
            const [row] = await db
              .insert(bugReportRateLimit)
              .values({ key, window, count: 1 })
              .onConflictDoUpdate({
                target: [bugReportRateLimit.key, bugReportRateLimit.window],
                set: { count: sql`${bugReportRateLimit.count} + 1` }
              })
              .returning({ count: bugReportRateLimit.count })
            const count = row?.count ?? Number.POSITIVE_INFINITY
            if (count === 1) {
              await db.delete(bugReportRateLimit).where(lt(bugReportRateLimit.window, window - 1))
            }
            return count
          })
      }
    })
  }
) {}
