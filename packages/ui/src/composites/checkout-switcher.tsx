import type { SessionCheckout } from "@jingler/core"
import { FolderGit2 } from "lucide-react"
import { ChipMenu, type ChipOption } from "../components/chip-menu.js"

const repoName = (repo: string): string => repo.split("/").filter(Boolean).at(-1) ?? repo

/** The `repo · branch` label one checkout carries everywhere it is named. */
export const checkoutLabel = (checkout: SessionCheckout): string => `${repoName(checkout.repo)} · ${checkout.branch}`

/**
 * Composer repo menu for a multi-repo session: the active checkout's repo, opening
 * a list of every `repo · branch`. Renders nothing for a single checkout.
 */
export function CheckoutSwitcher({
  checkouts,
  activeCheckoutId,
  onSwitch
}: {
  readonly checkouts: ReadonlyArray<SessionCheckout>
  readonly activeCheckoutId: string
  readonly onSwitch?: (checkoutId: string) => void
}) {
  if (checkouts.length < 2) return null
  const options: ReadonlyArray<ChipOption<string>> = checkouts.map((checkout) => ({
    value: checkout.id,
    label: checkoutLabel(checkout),
    searchText: `${checkout.repo} ${checkout.branch}`
  }))
  const active = checkouts.find((checkout) => checkout.id === activeCheckoutId) ?? checkouts[0]
  return (
    <span data-testid="checkout-switcher" className="flex min-w-0">
      <ChipMenu
        value={active?.id ?? ""}
        options={options}
        onSelect={onSwitch}
        disabled={onSwitch === undefined}
        appearance="quiet"
        side="top"
        ariaLabel="Switch repository"
        trigger={() => (
          <span
            title={`Switch repository (${checkouts.length} attached)`}
            className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-surface hover:text-text-bright"
          >
            <FolderGit2 size={12} className="flex-none" />
            <span className="truncate">{active ? repoName(active.repo) : ""}</span>
            <span className="flex-none">+{checkouts.length - 1}</span>
          </span>
        )}
      />
    </span>
  )
}
