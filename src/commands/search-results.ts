import type { PriceQuote } from "../term.js";

/**
 * What the search API answers for one name, and the plain labels the CLI
 * prints for the names it never checked or the registry holds back.
 */

export interface ForSaleInfo {
  price: number;
  currency: string;
  source: string;
  buyable: boolean;
  url?: string;
}

export interface SearchResult extends PriceQuote {
  domain: string;
  available: boolean;
  price: number;
  currency: string;
  /** What each year after the first costs, in USD, when known */
  renewal_price?: number;
  error?: boolean;
  /** Domain is listed for sale (marketplace or external) */
  for_sale?: ForSaleInfo;
  /** Where the suffix sits against the DNS root zone: tld, second_level or alt_root (#651) */
  tld_kind?: "tld" | "second_level" | "alt_root";
  /** Set when the registry holds the name back although RDAP calls it unregistered */
  registry_status?: "premium" | "reserved";
  /** Premium only: the registry's first-year price in USD, when known */
  registry_price?: number;
  /** Why the server does not offer the name (alt_root, not sold and registry_status results) */
  reason?: string;
}

/**
 * A name under an extension Domani does not sell (gwendall-test.cn). The
 * server does not check it: it answers `available: false`, `price` 0 and a
 * `reason`, so it is never shown as available or taken.
 */
export function notSold(r: Pick<SearchResult, "available" | "error" | "registry_status" | "price" | "reason" | "tld_kind">): boolean {
  return !r.available && !r.error && !r.registry_status && r.price === 0 && !!r.reason && !notInPublicDns(r);
}

export const NOT_SOLD_LABEL = "not sold on Domani";

/**
 * A name under a TLD outside the IANA root zone (#651). The server does not
 * check it and says why in `reason`: it does not resolve in public DNS, so it
 * is never shown as available or taken.
 */
export function notInPublicDns(r: Pick<SearchResult, "tld_kind">): boolean {
  return r.tld_kind === "alt_root";
}

/** The plain sentence for such a name: the server's reason, or the same fact when an older server sent none. */
export function notInPublicDnsReason(r: Pick<SearchResult, "domain" | "reason">): string {
  return r.reason || `${r.domain} does not resolve in public DNS: its TLD is not in the DNS root zone (IANA). Domani does not offer it.`;
}

/**
 * A name RDAP calls unregistered that the registry holds back: a premium it
 * prices itself, or a reserved name. The server marks it not available and
 * says why in `reason`, so it is never shown as available or taken.
 */
export function heldByRegistry(r: Pick<SearchResult, "registry_status">): boolean {
  return r.registry_status === "premium" || r.registry_status === "reserved";
}

/** The short status for such a name: "premium $1250.20" (the price when known) or "reserved". */
export function registryLabel(r: Pick<SearchResult, "registry_status" | "registry_price">): string {
  if (r.registry_status === "reserved") return "reserved";
  return r.registry_price !== undefined ? `premium $${r.registry_price.toFixed(2)}` : "premium";
}

/** The plain sentence for such a name: the server's reason, or the same fact when an older server sent none. */
export function registryReason(r: Pick<SearchResult, "domain" | "registry_status" | "registry_price" | "reason">): string {
  if (r.reason) return r.reason;
  if (r.registry_status === "reserved") return `${r.domain} is reserved by the registry and cannot be registered.`;
  const priced = r.registry_price !== undefined ? `: the registry prices it at $${r.registry_price.toFixed(2)}` : " priced by the registry";
  return `${r.domain} is a premium name${priced}. Premium names cannot be bought at the standard price.`;
}

/**
 * Removes the earlier result for this domain and returns where it was (-1 if
 * none). The server sends a name again when it corrects it (a registry
 * premium or reserved name, an RDAP false positive): the latest answer wins.
 */
export function dropResult(list: Array<{ domain: string }>, domain: string): number {
  const at = list.findIndex((r) => r.domain === domain);
  if (at !== -1) list.splice(at, 1);
  return at;
}
