/** Checks grouped by checkout for a multi-repo session; renders nothing for one checkout. */
import { useQuery } from "@tanstack/react-query"
import { checkoutsOf, type Session, type SessionCheckout } from "@jingler/core"
import { PrCheckRow, checkoutLabel } from "@jingler/ui"
import { rpc } from "./rpc-client.js"
import { retryUnlessRateLimited } from "./github-poll.js"
import { PR_REFRESH_MS, useReloadOnPrChange } from "./use-pull-request.js"

/** One checkout's checks: the full PR read is never polled, only reloaded when the cheap state changes. */
function CheckoutChecksSection({ sessionId, checkout }: { readonly sessionId: string; readonly checkout: SessionCheckout }) {
  const key = ["github", "pr-checkout", sessionId, checkout.id, checkout.prNumber] as const
  const pr = useQuery({
    queryKey: key,
    queryFn: () => rpc.githubPr(sessionId, undefined, checkout.id),
    staleTime: PR_REFRESH_MS,
    retry: retryUnlessRateLimited
  })
  useReloadOnPrChange(key, sessionId, checkout.prNumber, checkout.id)
  const checks = pr.data?.checks ?? []
  return (
    <section data-testid={`checks-checkout-${checkout.id}`} className="flex flex-col gap-2">
      <h3 className="font-mono text-[10.5px] uppercase tracking-wide text-dim">
        {checkoutLabel(checkout)} · #{checkout.prNumber}
      </h3>
      {checks.length === 0 ? (
        <p className="text-[12px] text-dim">No checks reported.</p>
      ) : (
        checks.map((check) => <PrCheckRow key={check.name.toLowerCase()} check={check} />)
      )}
    </section>
  )
}

export function CheckoutChecks({ session }: { readonly session: Session }) {
  const checkouts = checkoutsOf(session)
  if (checkouts.length < 2) return null
  return (
    <div data-testid="checkout-checks" className="flex flex-col gap-3 border-b border-line bg-panel px-4 py-3">
      {checkouts
        .filter((checkout) => checkout.prNumber !== null)
        .map((checkout) => <CheckoutChecksSection key={checkout.id} sessionId={session.id} checkout={checkout} />)}
    </div>
  )
}
