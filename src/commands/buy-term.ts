import { fail } from "../ui.js";
import { belowMinimumHint, belowMinimumMessage, buyRefusal, MAX_YEARS, parseYears, type TermRefusal } from "../term.js";

interface Output {
  years?: string;
  json?: boolean;
  fields?: string;
}

/** The years --years asks for, or undefined to let the server pick each TLD's minimum. */
export function requestedYears(options: Output): number | undefined {
  const years = parseYears(options.years);
  if (years === null) fail(`--years must be a whole number from 1 to ${MAX_YEARS}, got "${options.years}"`, { code: "validation_error", json: options.json, fields: options.fields });
  return years;
}

/** --years is below a TLD's minimum: refuse before any call, as the server would (TERM_BELOW_MINIMUM; `terms` for a bulk buy). */
export function failBelowMinimum(refusals: TermRefusal[], bulk: boolean, options: Output): never {
  fail(belowMinimumMessage(refusals), {
    code: "TERM_BELOW_MINIMUM",
    hint: belowMinimumHint(Math.max(...refusals.map((r) => r.min_years))),
    data: bulk ? { terms: refusals } : refusals[0],
    json: options.json,
    fields: options.fields,
  });
}

/** A refused buy: the server's words as they are; a term or registrar refusal keeps its code and body. */
export function failBuy(body: Record<string, any>, status: number, options: Output): never {
  const refusal = buyRefusal(body);
  if (refusal) fail(body.error, { code: refusal.code, hint: options.json ? undefined : refusal.hint, status, data: body, json: options.json, fields: options.fields });
  fail(body.error || body.message, { hint: body.hint, fixUrl: body.setup_url || body.payment_options?.card?.setup_url, status, json: options.json, fields: options.fields });
}
