import { apiRequest } from "../api.js";
import { confirm as clackConfirm } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, skipConfirm, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { APP_DOMAIN } from "../brand.js";

export async function transfer(
  domain: string,
  options: { authCode: string; yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  requireValidDomain(domain, options);
  if (!options.authCode) {
    fail("--auth-code is required", {
      hint: "Get the EPP/auth code from your current registrar.",
      code: "validation_error",
      json: options.json,
      fields: options.fields,
    });
  }

  const s = createSpinner(!options.json);

  // Pre-check eligibility before asking for confirmation
  s.start(`Checking transfer eligibility for ${fmt.domain(domain)}`);

  const checkRes = await apiRequest(`/api/domains/transfer-check?domain=${encodeURIComponent(domain)}`);
  const check = await checkRes.json();

  if (!checkRes.ok) {
    s.stop("Check failed");
    fail(check.error, { hint: check.hint, status: checkRes.status, json: options.json, fields: options.fields });
  }

  if (!check.eligible) {
    s.stop(`${S.error} Not eligible`);
    fail(check.reason || "Domain is not eligible for transfer.", {
      hint: check.hint,
      code: "not_eligible",
      json: options.json,
      fields: options.fields,
    });
  }

  s.stop(`${S.success} Eligible for transfer`);

  if (options.dryRun) {
    return dryRunOut("transfer", {
      domain,
      eligible: true,
      price: check.price,
      currency: check.currency || "USD",
      includes_renewal: true,
    }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    blank();
    const price = check.price != null ? ` for ${fmt.price(check.price.toFixed(2))}` : "";
    const ok = await clackConfirm({
      message: `Transfer ${pc.bold(domain)} to ${APP_DOMAIN}${price}? (includes 1 year renewal)`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  s.start(`Initiating transfer for ${fmt.domain(domain)}`);

  const res = await apiRequest("/api/domains/transfer", {
    method: "POST",
    body: JSON.stringify({ domain, auth_code: options.authCode }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Transfer failed");
    fail(data.error || data.message, { hint: data.hint, fixUrl: data.setup_url, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Transfer initiated`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Transfer Initiated");
  row("Domain", fmt.domain(data.domain));
  row("Status", pc.yellow(data.status || "pending"));
  if (data.price) row("Price", fmt.price(data.price) + pc.dim(` ${data.currency || "USD"}`));
  if (data.payment_method) row("Payment", data.payment_method);
  if (data.expires) row("Expires", new Date(data.expires).toLocaleDateString());
  if (data.hint) {
    blank();
    console.log(`  ${pc.dim(data.hint)}`);
  }
  blank();
  hintCommand("Check transfer progress:", `domani status ${data.domain}`);
  blank();
}
