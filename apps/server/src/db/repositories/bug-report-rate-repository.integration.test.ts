import { afterAll, describe, expect, it } from "vitest"
import { createBugReportRoutes } from "../../bug-report-routes.js"
import { runtime } from "../../runtime.js"
import { getSql } from "../client.js"
import { BugReportRateRepository } from "./bug-report-rate-repository.js"

const key = `it-${Date.now()}`

afterAll(async () => {
  await getSql()`delete from bug_report_rate_limit where key like ${"it-%"} or key like ${"ip:%"}`
  await getSql().end()
})

describe("BugReportRateRepository (real Postgres)", () => {
  it("counts atomically under concurrency and prunes old windows", async () => {
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => runtime.runPromise(BugReportRateRepository.hit(key, 1000)))
    )
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    await runtime.runPromise(BugReportRateRepository.hit(key, 1000 - 5))
    await runtime.runPromise(BugReportRateRepository.hit(key, 1002))
    const rows = await getSql()`select "window" from bug_report_rate_limit where key = ${key}`
    expect(rows.map((row) => Number(row.window))).not.toContain(995)
  })

  it("route returns 429 on the 6th request using the real limiter", async () => {
    const routes = createBugReportRoutes({
      config: () => ({ githubToken: "t", githubRepo: "a/b", r2Endpoint: "https://r2.test", r2Bucket: "b", r2AccessKeyId: "k", r2SecretAccessKey: "s", r2PublicUrl: "https://f.test" })
    })
    const send = () =>
      routes.request("/", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" }, body: "{}" })
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await send()).status)
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429])
  })
})
