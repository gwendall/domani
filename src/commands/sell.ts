import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

interface SellOptions {
  price?: string;
  description?: string;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
  fields?: string;
}

export async function sell(
  domain: string | undefined,
  options: SellOptions,
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  if (!options.price) {
    fail("Price required", { hint: "Usage: domani sell <domain> --price <amount>", code: "validation_error", json: options.json, fields: options.fields });
  }
  const price = parseFloat(options.price);
  if (isNaN(price) || price <= 0) {
    fail("Price must be a positive number", { hint: `Got: "${options.price}"`, code: "validation_error", json: options.json, fields: options.fields });
  }

  if (options.dryRun) return dryRunOut("sell", { domain, price, description: options.description }, options.json, options.fields);

  const s = createSpinner(!options.json);
  s.start(`Listing ${fmt.domain(domain)} for ${fmt.price(price)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/for-sale`, {
    method: "PUT",
    body: JSON.stringify({ price, description: options.description }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Listed for sale`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Domain Listed");
  row("Domain", fmt.domain(data.listing.domain));
  row("Price", fmt.price(data.listing.price));
  if (data.listing.description) row("Description", data.listing.description);
  row("Status", pc.green("active"));
  blank();
  hintCommand("Cancel listing:", `domani unsell ${domain}`);
  blank();
}
