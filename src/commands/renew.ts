import { apiRequest } from "../api.js";
import { confirm as clackConfirm } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, skipConfirm, dryRunOut, fail, asAccount } from "../ui.js";
import { actingAsLabel } from "../config.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";
import { acceptNewPrice, parseMaxPrice, priceToAccept, roundToCent } from "../max-price.js";

export async function renew(
  domain: string | undefined,
  options: { years?: string; maxPrice?: string; yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);
  const years = options.years ? parseInt(options.years, 10) : 1;

  if (isNaN(years) || years < 1 || years > 10) {
    fail("--years must be between 1 and 10", { code: "validation_error", json: options.json, fields: options.fields });
  }
  const requested = parseMaxPrice(options.maxPrice, options);
  const term = `${years} year${years > 1 ? "s" : ""}`;

  const s = createSpinner(!options.json);
  s.start(`Checking ${fmt.domain(domain)}`);
  const infoRes = await apiRequest(`/api/domains/${encodeURIComponent(domain)}`);
  const info = await infoRes.json();
  if (!infoRes.ok) {
    s.stop("Lookup failed");
    fail(info.error, { hint: info.hint, status: infoRes.status, json: options.json, fields: options.fields });
  }
  const yearly = typeof info.renewal_price === "number" ? info.renewal_price : undefined;
  const total = yearly !== undefined ? roundToCent(yearly * years) : undefined;
  s.stop(yearly !== undefined
    ? `${S.success} ${fmt.domain(domain)} ${S.dot} renews at ${fmt.price(yearly.toFixed(2))}/yr`
    : `${fmt.domain(domain)} ${S.dot} ${pc.dim("renewal price unknown")}`);

  // The renewal charges nothing above the total shown, unless --max-price says otherwise.
  let ceiling = requested ?? total;

  if (options.dryRun) {
    return dryRunOut("renew", { domain, years, price: total, currency: "USD", max_price: ceiling, acting_as: actingAsLabel() }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    const ok = await clackConfirm({
      message: total !== undefined
        ? `Renew ${pc.bold(domain)} for ${term} for ${fmt.price(total.toFixed(2))}${asAccount()}?`
        : `Renew ${pc.bold(domain)} for ${term}${asAccount()}? You will be charged.`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  let res: Response;
  let data;
  let progress;
  for (;;) {
    progress = createSpinner(!options.json);
    progress.start(`Renewing ${fmt.domain(domain)}`);
    res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/renew`, {
      method: "POST",
      body: JSON.stringify({ years, ...(ceiling !== undefined ? { max_price: ceiling } : {}) }),
    });
    data = await res.json();

    const price = res.ok ? undefined : priceToAccept(data);
    if (price === undefined) break;
    progress.stop("Price changed");
    const accepted = await acceptNewPrice(price, ceiling ?? price, data, "Renew", options);
    if (accepted === undefined) return;
    ceiling = accepted;
  }

  if (!res.ok) {
    progress.stop("Renewal failed");
    fail(data.error || data.message, { hint: data.hint, fixUrl: data.setup_url || data.payment_options?.card?.setup_url, status: res.status, json: options.json, fields: options.fields });
  }

  progress.stop(`${S.success} Domain renewed`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Renewal Complete");
  row("Domain", fmt.domain(data.domain));
  row("Years", String(data.renewed_years));
  row("New expiry", new Date(data.new_expiry).toLocaleDateString());
  if (data.price) row("Price", fmt.price(data.price.toFixed(2)) + pc.dim(` ${data.currency || "USD"}`));
  if (data.payment_method) row("Payment", data.payment_method);
  blank();
  hintCommand("Verify renewal:", `domani status ${data.domain}`);
  blank();
}
