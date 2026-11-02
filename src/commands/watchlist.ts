import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, table, hintCommand, createSpinner, jsonOut, fail, dryRunOut } from "../ui.js";
import { requireValidDomain } from "../validate.js";

export interface Watch {
  domain: string;
  phase: string;
  created_at?: string;
  registered_at?: string | null;
  expires_at?: string | null;
  for_sale?: { source?: string; url?: string; price?: number | null } | null;
  last_checked_at?: string | null;
  backorder_id?: string | null;
}

interface Options {
  json?: boolean;
  fields?: string;
  dryRun?: boolean;
}

const PHASES: Record<string, (text: string) => string> = {
  registered: pc.dim,
  expiring: pc.yellow,
  expired: pc.yellow,
  redemption: pc.red,
  pending_delete: pc.red,
  available: pc.green,
  unknown: pc.dim,
};

/** Where a followed name stands, in words: "pending delete", "checking" for a registry that has not answered yet. */
export function phaseLabel(phase: string): string {
  if (phase === "pending_delete") return "pending delete";
  if (phase === "unknown") return "checking";
  return phase;
}

function colorPhase(phase: string): string {
  return (PHASES[phase] ?? pc.dim)(phaseLabel(phase));
}

/** "2027-03-14" from an ISO date, "-" when the registry does not publish it. */
export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "-";
}

/** "Afternic $2500", "Afternic", or "-" when the name is not listed for sale. */
export function forSaleLabel(sale: Watch["for_sale"]): string {
  if (!sale) return "-";
  const source = sale.source || "for sale";
  return sale.price != null ? `${source} $${sale.price}` : source;
}

/** The server's code, kept for the JSON output: WATCHLIST_LIMIT is a 403 that is not about signing in. */
function errorCode(data: { code?: string }): string | undefined {
  return data.code === "WATCHLIST_LIMIT" ? "limit_reached" : undefined;
}

export async function follow(domain: string, options: Options): Promise<void> {
  requireValidDomain(domain, options);
  if (options.dryRun) return dryRunOut("follow", { domain }, options.json, options.fields);

  const s = createSpinner(!options.json);
  s.start(`Following ${fmt.domain(domain)}`);
  const res = await apiRequest("/api/watchlist", { method: "POST", body: JSON.stringify({ domain }) });
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, code: errorCode(data), json: options.json, fields: options.fields });
  }

  const watch: Watch = data.watch;
  s.stop(res.status === 201 ? `${S.success} Following ${fmt.domain(watch.domain)}` : `${S.success} Already following ${fmt.domain(watch.domain)}`);
  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  row("Now", colorPhase(watch.phase));
  if (watch.expires_at) row("Expires", day(watch.expires_at));
  if (watch.for_sale) row("For sale", forSaleLabel(watch.for_sale));
  blank();
  console.log(`  ${pc.dim("You get an alert in the app and by email at each next step, until it drops.")}`);
  if (watch.phase === "available") hintCommand("It is free now. Register it:", `domani buy ${watch.domain}`);
  else hintCommand("See every name you follow:", "domani watchlist");
  blank();
}

export async function unfollow(domain: string, options: Options): Promise<void> {
  requireValidDomain(domain, options);
  if (options.dryRun) return dryRunOut("unfollow", { domain }, options.json, options.fields);

  const s = createSpinner(!options.json);
  s.start(`Unfollowing ${fmt.domain(domain)}`);
  const res = await apiRequest(`/api/watchlist/${encodeURIComponent(domain)}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} No longer following ${fmt.domain(domain)}`);
  if (options.json) jsonOut(data, options.fields);
}

export async function watchlist(options: Omit<Options, "dryRun">): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading the names you follow");
  const res = await apiRequest("/api/watchlist");
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const watches: Watch[] = data.watches || [];
  s.stop(`${S.success} ${watches.length} followed`);
  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (watches.length === 0) {
    blank();
    console.log(`  ${pc.dim("You follow no names yet.")}`);
    blank();
    hintCommand("Follow a taken name for free:", "domani follow <domain>");
    blank();
    return;
  }

  heading("Names you follow");
  table(
    ["Domain", "Now", "Expires", "For sale", "Backorder"],
    watches.map((w) => [
      fmt.domain(w.domain),
      colorPhase(w.phase),
      day(w.expires_at),
      forSaleLabel(w.for_sale),
      w.backorder_id ? pc.green("yes") : pc.dim("-"),
    ]),
  );
  blank();
  hintCommand("Stop following one:", "domani unfollow <domain>");
  blank();
}
