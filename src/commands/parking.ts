import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

export async function parking(
  domain: string | undefined,
  action: string | undefined,
  value: string | undefined,
  options: { dryRun?: boolean; json?: boolean; fields?: string },
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  // No action: show parking status
  if (!action) {
    return showParking(domain, options.json, options.fields);
  }

  switch (action) {
    case "enable":
    case "on":
      if (options.dryRun) return dryRunOut("parking_enable", { domain }, options.json, options.fields);
      return toggleParking(domain, true, options.json, options.fields);
    case "disable":
    case "off":
      if (options.dryRun) return dryRunOut("parking_disable", { domain }, options.json, options.fields);
      return toggleParking(domain, false, options.json, options.fields);
    case "price": {
      if (!value) {
        fail("Price required", { hint: "Usage: domani parking <domain> price <amount>", code: "validation_error", json: options.json, fields: options.fields });
      }
      const price = parseFloat(value);
      if (isNaN(price) || price <= 0) {
        fail("Price must be a positive number", { hint: `Got: "${value}"`, code: "validation_error", json: options.json, fields: options.fields });
      }
      if (options.dryRun) return dryRunOut("parking_price", { domain, price }, options.json, options.fields);
      return setPrice(domain, price, options.json, options.fields);
    }
    case "unprice":
    case "unlist":
      if (options.dryRun) return dryRunOut("parking_unlist", { domain }, options.json, options.fields);
      return setPrice(domain, null, options.json, options.fields);
    default:
      fail(`Unknown action: ${action}`, { hint: "Actions: enable, disable, price <amount>, unprice", code: "validation_error", json: options.json, fields: options.fields });
  }
}

async function showParking(domain: string, json?: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start(`Loading ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop(`${S.success} ${fmt.domain(domain)}`);

  if (json) {
    jsonOut({
      domain: data.domain,
      parking_enabled: data.parking_enabled,
      listing_price: data.listing_price,
    }, fields);
    return;
  }

  heading("Parking");
  row("Domain", fmt.domain(data.domain));
  row("Parking", data.parking_enabled ? pc.green("enabled") : pc.dim("disabled"));
  row("Listing", data.listing_price
    ? `${fmt.price(data.listing_price)} ${pc.dim("(for sale)")}`
    : pc.dim("not listed"));
  blank();
  hintCommand("Enable parking:", `domani parking ${domain} enable`);
  hintCommand("Set sale price:", `domani parking ${domain} price 499`);
  hintCommand("View analytics:", `domani analytics ${domain}`);
  blank();
}

async function toggleParking(domain: string, enabled: boolean, json?: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start(`${enabled ? "Enabling" : "Disabling"} parking for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/parking`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
  const data = await res.json();

  if (res.status === 409 && data.requires_confirmation) {
    s.stop(`${S.warning} DNS records will be replaced`);

    if (json) {
      jsonOut(data, fields);
      return;
    }

    console.log(`\n  ${pc.yellow("Enabling parking will replace these DNS records:")}`);
    for (const r of data.existing_dns || []) {
      console.log(`    ${pc.dim(r.type)} ${r.name} ${pc.dim("→")} ${r.value}`);
    }
    console.log(`\n  ${pc.dim("Run again with --confirm to proceed (not implemented yet).")}`);
    console.log(`  ${pc.dim("Or use the dashboard to confirm.")}`);
    blank();
    return;
  }

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop(`${S.success} Parking ${enabled ? "enabled" : "disabled"}`);

  if (json) {
    jsonOut(data, fields);
    return;
  }

  heading("Parking Updated");
  row("Domain", fmt.domain(data.domain));
  row("Parking", data.parking_enabled ? pc.green("enabled") : pc.dim("disabled"));
  if (data.hint) row("", pc.dim(data.hint));
  blank();
}

async function setPrice(domain: string, price: number | null, json?: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start(price !== null
    ? `Setting price for ${fmt.domain(domain)} to ${fmt.price(price)}`
    : `Removing listing for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/parking`, {
    method: "PUT",
    body: JSON.stringify({ listing_price: price }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop(`${S.success} ${price !== null ? "Price set" : "Listing removed"}`);

  if (json) {
    jsonOut(data, fields);
    return;
  }

  heading("Listing Updated");
  row("Domain", fmt.domain(data.domain));
  row("Listing", data.listing_price
    ? `${fmt.price(data.listing_price)} ${pc.dim("(for sale)")}`
    : pc.dim("not listed"));
  if (data.hint) row("", pc.dim(data.hint));
  blank();
}
