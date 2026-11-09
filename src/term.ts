import { perYear } from "./per-year.js";

/**
 * The price fields of a search or suggest result. A TLD the registry does not
 * sell for one year (.ai: 2 years) adds min_years and min_term_price; `price`
 * stays the price of one year.
 */
export interface PriceQuote {
  price?: number;
  renewal_price?: number;
  /** Set only above 1: the fewest years a registration takes under this TLD. */
  min_years?: number;
  /** With min_years: the total of that minimum term, in USD. */
  min_term_price?: number;
}

/** The term a buy registers and what it costs in total, in USD. */
export interface Term {
  years: number;
  min_years: number;
  total?: number;
}

/** What the server refuses with TERM_BELOW_MINIMUM, for one name. */
export type TermRefusal = {
  domain: string;
  requested_years: number;
  min_years: number;
  /** The total of the minimum term, in USD, when known. */
  price?: number;
};

export const MAX_YEARS = 10;

const cents = (amount: number) => Math.round(amount * 100) / 100;
const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** "1 year", "2 years". */
export function yearsLabel(years: number): string {
  return `${years} year${years === 1 ? "" : "s"}`;
}

/** The fewest years the TLD sells: 1 unless the result says more. */
export function minYearsOf(q: PriceQuote): number {
  return typeof q.min_years === "number" && Number.isInteger(q.min_years) && q.min_years > 1 ? q.min_years : 1;
}

/** The years --years asks for: undefined when absent, null when it is not a whole number from 1 to 10. */
export function parseYears(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value.trim())) return null;
  const years = Number(value.trim());
  return years >= 1 && years <= MAX_YEARS ? years : null;
}

/**
 * The term a buy registers: the requested years, or else the TLD's minimum,
 * as the server picks when years is left out. The total is min_term_price for
 * the minimum term, else the yearly price times the years, as the server bills.
 */
export function termOf(q: PriceQuote, requested?: number): Term {
  const min = minYearsOf(q);
  const years = requested ?? min;
  const total = years === min && min > 1 && typeof q.min_term_price === "number"
    ? q.min_term_price
    : typeof q.price === "number" ? cents(q.price * years) : undefined;
  return { years, min_years: min, ...(total !== undefined ? { total } : {}) };
}

function multiYear(q: PriceQuote, term: Term): { total: number; minimum: string; then: string } | undefined {
  if (term.years === 1 || term.total === undefined || typeof q.price !== "number") return undefined;
  return {
    total: term.total,
    minimum: term.years === term.min_years ? ` (${term.min_years}-year minimum)` : "",
    then: `, then ${usd(q.renewal_price ?? q.price)}/yr`,
  };
}

/** "$14.50/yr" for one year, "$169.40 for 2 years (2-year minimum), then $84.70/yr" for a longer term. */
export function termPrice(q: PriceQuote, term: Term = termOf(q)): string {
  if (typeof q.price !== "number") return "";
  const m = multiYear(q, term);
  return m ? `${usd(m.total)} for ${yearsLabel(term.years)}${m.minimum}${m.then}` : perYear(q.price, q.renewal_price);
}

/** "for $14.50/yr" for one year, "for 2 years: $169.40 (2-year minimum), then $84.70/yr" for a longer term. */
export function termPhrase(q: PriceQuote, term: Term): string {
  const m = multiYear(q, term);
  if (m) return `for ${yearsLabel(term.years)}: ${usd(m.total)}${m.minimum}${m.then}`;
  return typeof q.price === "number" ? `for ${perYear(q.price, q.renewal_price)}` : `for ${yearsLabel(term.years)}`;
}

/** The fields a dry run adds for the term: years, min_years above 1, and the total of the term. */
export function termFields(term: Term): Record<string, number> {
  return {
    years: term.years,
    ...(term.min_years > 1 ? { min_years: term.min_years } : {}),
    ...(term.total !== undefined ? { total_price: term.total } : {}),
  };
}

/** " (doobeedoo.ai for 2 years, the .ai minimum)" for the names of a bulk buy bought for more than a year. */
export function longerTerms(items: Array<{ domain: string; term: Term }>): string {
  const longer = items.filter((i) => i.term.years > 1);
  if (longer.length === 0) return "";
  const each = longer.map(({ domain, term }) =>
    `${domain} for ${yearsLabel(term.years)}${term.years === term.min_years ? `, the ${domain.slice(domain.indexOf("."))} minimum` : ""}`);
  return ` (${each.join("; ")})`;
}

/** The refusal the server would give when the requested years are below the TLD's minimum, or undefined. */
export function belowMinimum(domain: string, q: PriceQuote, requested: number | undefined): TermRefusal | undefined {
  const min = minYearsOf(q);
  if (requested === undefined || requested >= min) return undefined;
  const { total } = termOf(q);
  return { domain, requested_years: requested, min_years: min, ...(total !== undefined ? { price: total } : {}) };
}

/** "doobeedoo.ai cannot be registered for 1 year: .ai names are registered for at least 2 years, $169.40 in total." */
export function belowMinimumMessage(refusals: TermRefusal[]): string {
  return refusals.map((r) => {
    const total = r.price !== undefined ? `, ${usd(r.price)} in total` : "";
    return `${r.domain} cannot be registered for ${yearsLabel(r.requested_years)}: ${r.domain.slice(r.domain.indexOf("."))} names are registered for at least ${yearsLabel(r.min_years)}${total}.`;
  }).join(" ");
}

/** The flag that clears a TERM_BELOW_MINIMUM refusal. */
export function belowMinimumHint(minYears: number): string {
  return `Re-run with --years ${minYears}, or leave --years out for the minimum term.`;
}

const REFUSAL_CODES = new Set(["TERM_BELOW_MINIMUM", "TERM_NOT_SUPPORTED", "REGISTRAR_UNAVAILABLE"]);

/**
 * For a term or registrar refusal of the buy: the server's code to keep and
 * the CLI flag that fixes it. Undefined for any other answer.
 */
export function buyRefusal(body: Record<string, unknown>): { code: string; hint?: string } | undefined {
  const code = typeof body.code === "string" ? body.code : "";
  if (!REFUSAL_CODES.has(code)) return undefined;
  const serverHint = typeof body.hint === "string" ? body.hint : undefined;
  if (code === "TERM_BELOW_MINIMUM") {
    const mins = Array.isArray(body.terms)
      ? (body.terms as Array<{ min_years?: unknown }>).map((t) => t.min_years)
      : [body.min_years];
    const min = Math.max(0, ...mins.filter((m): m is number => typeof m === "number"));
    return { code, hint: min > 1 ? belowMinimumHint(min) : serverHint };
  }
  if (code === "TERM_NOT_SUPPORTED") {
    const suggested = body.suggested_years;
    return { code, hint: typeof suggested === "number" ? `Re-run with --years ${suggested}.` : serverHint };
  }
  const retry = body.retry_after;
  return { code, hint: typeof retry === "number" ? `Try again in ${retry} seconds.` : serverHint };
}

/** The price fields of a result that a buy carries over, so it shows and caps the same term. */
export function quoteOf<T extends PriceQuote & { price: number; currency: string }>(r: T) {
  return { price: r.price, currency: r.currency, renewal_price: r.renewal_price, min_years: r.min_years, min_term_price: r.min_term_price };
}
