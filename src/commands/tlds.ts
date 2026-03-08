import { publicRequest } from "../api.js";
import pc from "picocolors";
import { fmt, heading, blank, table, createSpinner, jsonOut, fail } from "../ui.js";

interface TldInfo {
  tld: string;
  registration: number;
  renewal: number;
}

export async function tlds(options: {
  maxPrice?: string;
  minPrice?: string;
  sort?: string;
  search?: string;
  limit?: string;
  json?: boolean;
  fields?: string;
}): Promise<void> {
  const params = new URLSearchParams();
  if (options.maxPrice) params.set("max_price", options.maxPrice);
  if (options.minPrice) params.set("min_price", options.minPrice);
  if (options.sort) params.set("sort", options.sort);
  if (options.search) params.set("search", options.search);
  if (options.limit) params.set("limit", options.limit);
  params.set("order", "asc");

  const s = createSpinner(!options.json);
  s.start("Loading TLDs");

  const res = await publicRequest(`/api/tlds?${params}`);
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
  ]);

  table(["TLD", "Register", "Renewal"], rows, [22, 16, 20]);

  blank();
  console.log(`  ${pc.dim(`${data.total} TLDs total`)}`);
  blank();
}
