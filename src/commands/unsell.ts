import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

interface UnsellOptions {
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
  fields?: string;
}

export async function unsell(
  domain: string | undefined,
  options: UnsellOptions,
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  if (options.dryRun) return dryRunOut("unsell", { domain }, options.json, options.fields);

  const s = createSpinner(!options.json);
  s.start(`Removing listing for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/for-sale`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Listing cancelled`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Listing Removed");
  row("Domain", fmt.domain(data.domain));
  row("Status", pc.dim("cancelled"));
  blank();
}
