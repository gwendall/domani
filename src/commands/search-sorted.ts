import pc from "picocolors";
import { publicRequest } from "../api.js";
import { S, fmt, blank, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { termPrice } from "../term.js";
import { fetchAllTlds } from "./search.js";
import { heldByRegistry, notInPublicDns, notSold, registryLabel, NOT_SOLD_LABEL, type SearchResult } from "./search-results.js";

export const SEARCH_SORTS = ["dropping", "newest"] as const;
export type LifecycleSort = (typeof SEARCH_SORTS)[number];

/** TLDs a sorted search checks by default: one batch of registry lookups on the server. */
const SORTED_TLDS = 50;
const MAX_BULK_DOMAINS = 200;

/** What the server attaches to a taken name under sort=dropping or sort=newest. */
export interface Registration {
  created: string | null;
  expires: string | null;
  updated?: string | null;
  status?: string[];
  last_transfer?: string | null;
  drop_estimate?: { date: string; estimated: boolean } | null;
  summary: string | null;
}

export type SortedResult = SearchResult & { registration?: Registration | null };

/** The reason column of a taken name: the server's plain-English summary, or why there is none. */
export function reasonColumn(r: SortedResult): string {
  if (r.registration === undefined) return "not looked up (over the 50 names per request)";
  if (r.registration === null) return "the registry did not answer";
  return r.registration.summary ?? "no registry dates";
}

/** A name a backorder can catch: being deleted, in redemption or lapsed. */
export function canBackorder(r: SortedResult): boolean {
  const summary = r.registration?.summary ?? "";
  return /^(Being deleted|In redemption|Expired)/u.test(summary);
}

const isTaken = (r: SearchResult) => !r.available && !r.error && !r.reason && !r.registry_status;

function printRow(r: SortedResult): void {
  const name = r.domain.padEnd(38);
  if (isTaken(r)) {
    const reason = reasonColumn(r);
    const tone = canBackorder(r) ? pc.red : r.registration?.summary ? pc.yellow : pc.dim;
    console.log(`  ${S.error} ${pc.dim(name)} ${tone(reason)}`);
  } else if (r.available) {
    console.log(`  ${S.success} ${fmt.domain(r.domain).padEnd(37)} ${pc.green(termPrice(r))}`);
  } else if (notInPublicDns(r)) {
    console.log(`  ${S.warning} ${pc.dim(name)} ${pc.yellow("not in public DNS")}`);
  } else if (notSold(r)) {
    console.log(`  ${S.warning} ${pc.dim(name)} ${pc.yellow(NOT_SOLD_LABEL)}`);
  } else if (heldByRegistry(r)) {
    console.log(`  ${S.warning} ${pc.dim(name)} ${pc.yellow(registryLabel(r))}`);
  }
}

/**
 * `domani search <name> --sort dropping|newest`: the taken names first, the
 * ones about to become free (or registered most recently) on top, each with
 * why; the free names after them. One JSON request: the server ranks.
 */
export async function searchSorted(
  domain: string,
  tlds: string[],
  options: { sort?: string; maxPrice?: string; expand?: boolean; json?: boolean; fields?: string },
): Promise<void> {
  const sort = options.sort as LifecycleSort;
  if (!SEARCH_SORTS.includes(sort)) {
    fail(`Unknown sort: ${options.sort}`, { code: "invalid_argument", hint: "Use --sort dropping or --sort newest", json: options.json, fields: options.fields });
  }
  const name = domain.split(".")[0];
  const single = domain.includes(".") && tlds.length === 0;
  const all = single ? [] : await fetchAllTlds();
  const domains = single ? [domain] : (tlds.length > 0 ? tlds : all.slice(0, options.expand ? MAX_BULK_DOMAINS : SORTED_TLDS)).map((tld) => `${name}.${tld}`);
  const params = new URLSearchParams({ domains: domains.join(","), sort });
  if (options.maxPrice) params.set("max_price", options.maxPrice);

  const title = sort === "dropping" ? "Dropping soon" : "Newest registrations";
  const s = createSpinner(!options.json);
  s.start(`${title}: reading the registry for ${pc.bold(name)}`);
  const res = await publicRequest(`/api/domains/search?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    s.stop("Search failed");
    fail(data.error || data.message || `Server error (${res.status})`, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }
  const results: SortedResult[] = data.results ?? [];
  if (options.json) {
    s.stop();
    jsonOut({ name, sort, results, total: data.total, available: data.available, ...(data.registration_truncated ? { registration_truncated: true } : {}) }, options.fields);
    return;
  }

  const taken = results.filter(isTaken);
  s.stop(`${title} for ${pc.bold(name)} ${S.dot} ${taken.length} taken of ${results.length}`);
  blank();
  for (const r of results) printRow(r);
  console.log(`  ${pc.dim("─".repeat(50))}`);
  const truncatedBy = res.headers.get("x-truncated");
  if (truncatedBy) console.log(`  ${pc.dim(`Checked the first ${results.length} names: log in to check up to ${MAX_BULK_DOMAINS}.`)}`);
  if (data.registration_truncated) console.log(`  ${pc.dim("The registry was read for the first 50 taken names; the others come after them.")}`);
  const catchable = taken.find(canBackorder);
  if (catchable) {
    blank();
    hintCommand("Follow it for free:", `domani follow ${catchable.domain}`);
    console.log(`  ${pc.dim("Estimates follow ICANN's deletion cycle (30 days of redemption, then 5 of pending delete).")}`);
  }
  blank();
}
