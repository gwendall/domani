import { apiRequest } from "../api.js";
import { confirm as clackConfirm } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, skipConfirm, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

export async function renew(
  domain: string | undefined,
  options: { years?: string; yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);
  const years = options.years ? parseInt(options.years, 10) : 1;

  if (isNaN(years) || years < 1 || years > 10) {
    fail("--years must be between 1 and 10", { code: "validation_error", json: options.json, fields: options.fields });
  }

  if (options.dryRun) {
    return dryRunOut("renew", { domain, years }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    const ok = await clackConfirm({
      message: `Renew ${pc.bold(domain)} for ${years} year${years > 1 ? "s" : ""}? You will be charged.`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  const s = createSpinner(!options.json);
  s.start(`Renewing ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/renew`, {
    method: "POST",
    body: JSON.stringify({ years }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Renewal failed");
    fail(data.error || data.message, { hint: data.hint, fixUrl: data.setup_url || data.payment_options?.card?.setup_url, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Domain renewed`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Renewal Complete");
  row("Domain", fmt.domain(data.domain));
  row("Years", String(data.renewed_years));
  row("New expiry", new Date(data.new_expiry).toLocaleDateString());
  if (data.price) row("Price", fmt.price(data.price) + pc.dim(` ${data.currency || "USD"}`));
  if (data.payment_method) row("Payment", data.payment_method);
  blank();
  hintCommand("Verify renewal:", `domani status ${data.domain}`);
  blank();
}
