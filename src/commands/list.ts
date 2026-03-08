import { apiRequest } from "../api.js";
import pc from "picocolors";
import { fmt, heading, blank, table, createSpinner, jsonOut, fail } from "../ui.js";

export async function list(options: { json?: boolean; fields?: string }): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading domains");

  const res = await apiRequest("/api/domains");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${data.domains.length} domain(s)`);

  if (options.json) {
    jsonOut({ ...data, count: data.domains.length }, options.fields);
    return;
  }

  if (data.domains.length === 0) {
    blank();
    console.log(`  ${pc.dim("No domains yet.")} Use: ${pc.cyan("domani buy <domain>")}`);
    blank();
    return;
  }

  const colWidths = [30, 12, 12, 14];
  heading(`Your Domains (${data.domains.length})`, colWidths.reduce((a, b) => a + b, 0) + colWidths.length - 1);

  const rows = data.domains.map((d: { domain: string; status: string; autoRenew: boolean; expiresAt: string }) => {
    const expires = new Date(d.expiresAt).toLocaleDateString();
    const statusColor = d.status === "active" ? pc.green : d.status === "pending" ? pc.yellow : pc.red;
    const autoRenew = d.autoRenew ? pc.green("on") : pc.dim("off");
    return [
      fmt.domain(d.domain),
      statusColor(d.status),
      autoRenew,
      pc.dim(expires),
    ];
  });

  table(["Domain", "Status", "Auto-renew", "Expires"], rows, colWidths);
  blank();
}
