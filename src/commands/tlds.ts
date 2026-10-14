import { publicRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, blank, table, createSpinner, jsonOut, fail } from "../ui.js";

/**
 * Where a suffix sits against the DNS root zone (#651): `tld` (in the IANA
 * root zone), `second_level` (an offering under one, such as co.uk) or
 * `alt_root` (outside the root zone, so it does not resolve in public DNS).
 */
type TldKind = "tld" | "second_level" | "alt_root";

interface TldInfo {
  tld: string;
  registration: number;
  renewal: number;
  kind?: TldKind;
}

interface TldsOptions {
  kind?: string;
  maxPrice?: string;
  minPrice?: string;
  sort?: string;
  search?: string;
  limit?: string;
  json?: boolean;
  fields?: string;
}

/** The /api/tlds query string for the command's options. The server defaults `kind` to tld,second_level. */
export function tldsQuery(options: TldsOptions): string {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.maxPrice) params.set("max_price", options.maxPrice);
  if (options.minPrice) params.set("min_price", options.minPrice);
  if (options.sort) params.set("sort", options.sort);
  if (options.search) params.set("search", options.search);
  if (options.limit) params.set("limit", options.limit);
  params.set("order", "asc");
  return params.toString();
}

/** The Kind column: a root-zone TLD needs no note, the other two say what they are. */
export function kindLabel(kind: TldKind | undefined): string {
  if (kind === "second_level") return "second level";
  if (kind === "alt_root") return "alt root, no public DNS";
  return "tld";
}

export async function tlds(options: TldsOptions): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading TLDs");

  const res = await publicRequest(`/api/tlds?${tldsQuery(options)}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${data.total} TLDs loaded`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  const list: TldInfo[] = data.tlds;
  if (list.length === 0) {
    blank();
    console.log(`  ${pc.dim("No TLDs match your filters.")}`);
    blank();
    return;
  }

  heading("TLD Pricing");

  const rows = list.map((t) => [
    pc.bold(`.${t.tld}`),
    fmt.price(t.registration.toFixed(2)) + pc.dim("/yr"),
    pc.dim("renew ") + fmt.price(t.renewal.toFixed(2)) + pc.dim("/yr"),
    t.kind === "alt_root" ? pc.yellow(kindLabel(t.kind)) : pc.dim(kindLabel(t.kind)),
  ]);

  table(["TLD", "Register", "Renewal", "Kind"], rows, [22, 16, 20, 24]);

  blank();
  console.log(`  ${pc.dim(`${data.total} TLDs total`)}`);
  if (list.some((t) => t.kind === "alt_root")) {
    console.log(`  ${S.warning} ${pc.yellow("alt root names are outside the IANA root zone: they do not resolve in public DNS, and Domani does not sell them.")}`);
  }
  blank();
}
