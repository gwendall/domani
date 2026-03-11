import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

const STATUS_COLORS: Record<string, (s: string) => string> = {
  none: pc.dim,
  pending: pc.yellow,
  approved: pc.yellow,
  completed: pc.green,
  rejected: pc.red,
  expired: pc.red,
};

export async function transferAway(
  domain: string | undefined,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  const s = createSpinner(!options.json);
  s.start(`Checking transfer status for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/transfer-away`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} ${fmt.domain(domain)}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Transfer Away Status");
  row("Domain", fmt.domain(data.domain));
  const colorFn = STATUS_COLORS[data.status] || pc.dim;
  row("Status", colorFn(data.status));
  if (data.gaining_registrar) row("New registrar", data.gaining_registrar);
  if (data.request_date) row("Requested", new Date(data.request_date).toLocaleDateString());
  if (data.hint) {
    blank();
    console.log(`  ${pc.dim(data.hint)}`);
  }
  blank();
  if (data.status === "none") {
    hintCommand("Get auth code to start:", `domani auth-code ${domain}`);
  } else if (data.status === "pending" || data.status === "approved") {
    hintCommand("Check again later:", `domani transfer-away ${domain}`);
  } else if (data.status === "completed") {
    hintCommand("Search for a new domain:", `domani search <name>`);
  } else if (data.status === "rejected" || data.status === "expired") {
    hintCommand("Retry with a new auth code:", `domani auth-code ${domain}`);
  }
  blank();
}
