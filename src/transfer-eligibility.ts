/**
 * Transfer-eligibility watching for the CLI.
 *
 * Two ineligibility classes exist and need different waits:
 * - date-based (ICANN 60-day windows): the plan carries `eligible_at` and the
 *   server can watch it (POST /api/domains/transfer-watch notifies by email +
 *   webhook when the date arrives) - polling for weeks in a foreground
 *   process is the wrong tool;
 * - lock-based (clientTransferProhibited): no determinable date, the unlock
 *   happens at the losing registrar and propagates within minutes - local
 *   polling is the only way to catch it.
 *
 * Field report: docs/DOMAIN-EXIT-DOGFOODING-2026-08-31.md (finding 4).
 */

export interface ExitGuidance {
  managed_via: string;
  unlock: string;
  auth_code: string;
  notes: string[];
}

export interface WatchOptions<T> {
  /** One poll. Return null (or throw) on a transient failure. */
  fetchPlan: () => Promise<T | null>;
  isEligible: (plan: T) => boolean;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
  maxAttempts: number;
  /** Consecutive fetch failures before giving up (default 10). */
  maxConsecutiveFailures?: number;
  onTick?: (plan: T | null, attempt: number) => void;
}

export type WatchOutcome<T> =
  | { status: "eligible"; plan: T }
  | { status: "timeout"; attempts: number }
  | { status: "unreachable"; failures: number };

/**
 * Poll until the domain becomes eligible. Transient fetch failures are
 * tolerated up to maxConsecutiveFailures; a success resets the counter.
 */
export async function waitForEligibility<T>(opts: WatchOptions<T>): Promise<WatchOutcome<T>> {
  const maxFailures = opts.maxConsecutiveFailures ?? 10;
  let failures = 0;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const plan = await opts.fetchPlan().catch(() => null);
    opts.onTick?.(plan, attempt);
    if (plan !== null) {
      failures = 0;
      if (opts.isEligible(plan)) return { status: "eligible", plan };
    } else {
      failures++;
      if (failures >= maxFailures) return { status: "unreachable", failures };
    }
    if (attempt < opts.maxAttempts) await opts.sleep(opts.intervalMs);
  }
  return { status: "timeout", attempts: opts.maxAttempts };
}
