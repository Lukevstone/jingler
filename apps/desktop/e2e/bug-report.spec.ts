import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { startFakeAuthServer } from "./fake-auth.js"
import { appShell, expect, test } from "./fixtures.js"

test("Report a bug files a report with a screenshot", async ({ launchApp }, testInfo) => {
  const authServer = await startFakeAuthServer()
  try {
    const { window } = await launchApp({ configured: true, authServer })
    await expect(appShell(window)).toBeVisible()
    await window.getByRole("button", { name: "Account menu" }).click()
    await window.getByRole("menuitem", { name: "Report a bug" }).click()

    await window.getByLabel("Title").fill("Sidebar flickers")
    await window.getByLabel("What happened?").fill("It flickers on resize")
    mkdirSync(testInfo.outputDir, { recursive: true })
    const png = join(testInfo.outputDir, "shot.png")
    writeFileSync(
      png,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
    )
    await window.getByRole("dialog").locator('input[type="file"]').setInputFiles(png)
    await window.getByRole("button", { name: "Send report" }).click()

    await expect(window.getByRole("link", { name: /issues\/1/ })).toBeVisible()
    const [report] = authServer.bugReports as Array<{ title: string; screenshots: unknown[] }>
    expect(report?.title).toBe("Sidebar flickers")
    expect(report?.screenshots).toHaveLength(1)
  } finally {
    await authServer.close()
  }
})
