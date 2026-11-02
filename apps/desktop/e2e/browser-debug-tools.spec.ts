import { createServer, type Server } from "node:http"
import { appShell, expect, test, type SeedSession } from "./fixtures.js"
import { openView } from "./views.js"

const session = ({ repoPath }: { repoPath: string }): ReadonlyArray<SeedSession> => [{
  id: "s_browser_debug",
  repo: "widget",
  branch: "chore/browser-debug",
  title: "Browser debug tools",
  status: "idle",
  diff: { added: 0, removed: 0 },
  prNumber: null,
  costUsd: 0,
  tokens: 0,
  updatedAt: "2026-08-11T00:00:00.000Z",
  worktreePath: repoPath,
  mode: "auto"
}]

const PAGE = `<!doctype html><title>Debug target</title>
<button id="go">Go</button>
<script>
document.getElementById("go").addEventListener("click", async () => {
  console.error("boom-from-page");
  await fetch("/api/fail").catch(() => {});
  const done = document.createElement("p");
  done.id = "done";
  document.body.appendChild(done);
});
</script>`

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })

test("the agent clicks in the Preview browser, then reads its console and failed requests", async ({
  launchApp
}) => {
  const targetServer = createServer((request, response) => {
    if (request.url === "/api/fail") {
      response.writeHead(500, { "Content-Type": "application/json" })
      response.end('{"error":"nope"}')
      return
    }
    response.writeHead(200, { "Content-Type": "text/html" })
    response.end(PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    targetServer.once("error", reject)
    targetServer.listen({ host: "127.0.0.1", port: 0 }, resolve)
  })
  const address = targetServer.address()
  if (address === null || typeof address === "string") {
    await closeServer(targetServer)
    throw new Error("Debug target server has no TCP address")
  }

  try {
    const { app, window } = await launchApp({
      configured: true,
      withRepo: true,
      piFixture: { scenarioId: "browser-debug", authRoute: "api-key" },
      sessions: session
    })
    await expect(appShell(window)).toBeVisible()
    await openView(window, "browser")
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit("focus"))

    const composer = window.getByPlaceholder(/message/i)
    await composer.fill(`Debug the page. [[browser-url=http://127.0.0.1:${address.port}/]]`)
    await composer.press("Enter")

    const final = window.getByText(/Browser debug results:/)
    await expect(final).toBeVisible({ timeout: 20_000 })
    await expect(final).toContainText("[error] boom-from-page")
    await expect(final).toContainText(/GET 500 Fetch \d+ms http:\/\/127\.0\.0\.1:\d+\/api\/fail/)
    await expect(window.getByTestId("browser-tool-icon-network_requests").first()).toBeVisible()
  } finally {
    await closeServer(targetServer)
  }
})
