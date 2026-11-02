import { createServer, type Server } from "node:http"
import { appShell, expect, test, type SeedSession } from "./fixtures.js"
import { openView } from "./views.js"

const session = ({ repoPath }: { repoPath: string }): ReadonlyArray<SeedSession> => [{
  id: "s_browser_ops",
  repo: "widget",
  branch: "chore/browser-ops",
  title: "Browser ops",
  status: "idle",
  diff: { added: 0, removed: 0 },
  prNumber: null,
  costUsd: 0,
  tokens: 0,
  updatedAt: "2026-08-11T00:00:00.000Z",
  worktreePath: repoPath,
  mode: "auto"
}]

// Smooth scrolling + a tall page: the hover target starts below the fold, so a
// cursor measured mid-scroll would miss it.
const pageA = (loadId: number) => `<!doctype html><title>Ops A</title>
<style>html { scroll-behavior: smooth } body { margin: 0 }</style>
<script>window.loadId = ${loadId}</script>
<p id="log"></p>
<form id="f"><input id="q" name="q"></form>
<select id="pick"><option value="a">First</option><option value="b">Second</option></select>
<div style="height: 2400px"></div>
<div id="menu" style="width: 120px; height: 40px; background: #888">Menu</div>
<script>
const log = (s) => { document.getElementById("log").textContent += (log.n++ ? " " : "") + s };
log.n = 0;
document.getElementById("menu").addEventListener("mouseover", () => log("hover"), { once: true });
document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); log("submit:" + document.getElementById("q").value) });
document.getElementById("pick").addEventListener("change", (e) => log("select:" + e.target.value));
</script>`

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("the agent's hover, keys, select, snapshot, screenshots, back and reload act on the real page", async ({
  launchApp
}) => {
  let loadsOfA = 0
  const targetServer = createServer(async (request, response) => {
    // Slow, uncacheable pages: back/reload must wait for the real load.
    await delay(600)
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" })
    if (request.url === "/ops-a") response.end(pageA(++loadsOfA))
    else if (request.url === "/ops-tall") response.end('<!doctype html><body style="margin:0"><div style="height:3000px;background:linear-gradient(#f00,#00f)"></div>')
    else response.end("<!doctype html><title>Ops B</title><h1>B</h1>")
  })
  await new Promise<void>((resolve, reject) => {
    targetServer.once("error", reject)
    targetServer.listen({ host: "127.0.0.1", port: 0 }, resolve)
  })
  const address = targetServer.address()
  if (address === null || typeof address === "string") {
    await closeServer(targetServer)
    throw new Error("Ops target server has no TCP address")
  }
  const origin = `http://127.0.0.1:${address.port}`

  try {
    const { app, window } = await launchApp({
      configured: true,
      withRepo: true,
      piFixture: { scenarioId: "browser-ops", authRoute: "api-key" },
      sessions: session
    })
    await expect(appShell(window)).toBeVisible()
    await openView(window, "browser")
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit("focus"))

    const composer = window.getByPlaceholder(/message/i)
    await composer.fill(`Exercise the page. [[browser-url=${origin}/]]`)
    await composer.press("Enter")

    const final = window.getByText(/Browser ops results:/)
    await expect(final).toBeVisible({ timeout: 45_000 })
    const text = (await final.textContent()) ?? ""
    const line = (id: string) => text.match(new RegExp(`${id}:([^\\n]*)`, "u"))?.[1] ?? ""

    expect(line("bo-log")).toContain("hover submit:hello select:b")
    expect(line("bo-snapshot")).toContain("#q")
    expect(line("bo-snapshot")).toContain("#pick")
    const dims = (id: string) => (line(id).match(/image (\d+)x(\d+)/u) ?? []).slice(1).map(Number)
    const [elW = 0, elH = 0] = dims("bo-shot-el")
    expect(elW).toBeGreaterThan(0)
    expect(elW).toBeLessThan(600) // the 120px menu at any device scale, not the viewport
    expect(elH).toBeLessThan(200)
    // pi resizes images to fit 2000x2000, so check shape, not size: the 1280x800
    // viewport is wider than tall; a full capture of the 3000px page is far taller.
    const [fullW = 1, fullH = 0] = dims("bo-shot-full")
    expect(fullH / fullW).toBeGreaterThan(2)
    expect(line("bo-url")).toContain(`${origin}/ops-a`)
    // nav, back, reload: three loads of A, and the read after reload saw the third.
    expect(loadsOfA).toBe(3)
    // pi forwards MCP results as JSON text.
    expect(line("bo-load-id")).toContain('"text":"3"')
    for (const id of ["bo-hover", "bo-key", "bo-select", "bo-back", "bo-reload"]) {
      expect(line(id), id).not.toContain("Error")
    }
  } finally {
    await closeServer(targetServer)
  }
})
