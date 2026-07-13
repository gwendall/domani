import { apiRequest } from "../api.js";
import { confirm as clackConfirm, text, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, skipConfirm, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { APP_DOMAIN } from "../brand.js";

export async function transfer(
  domain: string,
  options: { authCode?: string; yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  requireValidDomain(domain, options);
  const s = createSpinner(!options.json);

  // Inspect registrar and DNS continuity before asking for an EPP code.
  s.start(`Planning safe adoption for ${fmt.domain(domain)}`);

  const checkRes = await apiRequest(`/api/domains/adoption-plan?domain=${encodeURIComponent(domain)}`);
  const check = await checkRes.json();

  if (!checkRes.ok) {
    s.stop("Check failed");
    fail(check.error, { hint: check.hint, status: checkRes.status, json: options.json, fields: options.fields });
  }

  if (!check.options?.transfer?.eligible) {
    s.stop(`${S.error} Not eligible`);
    fail(check.options?.transfer?.reason || "Domain is not eligible for transfer.", {
      hint: check.warnings?.join(" "),
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
      price: check.options.transfer.price,
      currency: check.options.transfer.currency || "USD",
      includes_renewal: true,
      preserves_nameservers: true,
      migrates_dns: false,
      nameservers: check.current.nameservers,
      dns_provider: check.current.dns_provider,
      dnssec_enabled: check.current.dnssec_enabled,
    }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    heading("Transfer Safety Plan");
    row("Registrar", check.current.registrar || "Unknown");
    row("DNS provider", check.current.dns_provider);
    row("Nameservers", `${check.current.nameservers.length} preserved`);
    row("DNSSEC", check.current.dnssec_enabled ? pc.yellow("Enabled, DS will be verified") : "Not enabled");
    row("DNS migration", "Not requested");
    blank();
    const price = check.options.transfer.price != null ? ` for ${fmt.price(check.options.transfer.price.toFixed(2))}` : "";
    const ok = await clackConfirm({
      message: `Transfer ${pc.bold(domain)} to ${APP_DOMAIN}${price}? Nameservers stay unchanged and 1 year is included.`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  if (!options.authCode) {
    if (options.json || !process.stdout.isTTY) {
      fail("--auth-code is required", {
        hint: "The safety plan passed. Get the EPP/auth code from the current registrar and retry.",
        code: "validation_error",
        json: options.json,
        fields: options.fields,
      });
    }
    const code = await text({
      message: "Enter the EPP/auth code from your current registrar:",
      validate: (value) => (!value || value.trim().length === 0 ? "Auth code is required" : undefined),
    });
    if (isCancel(code)) process.exit(0);
    options.authCode = code as string;
  }

  s.start(`Initiating transfer for ${fmt.domain(domain)}`);

  const res = await apiRequest("/api/domains/transfer", {
    method: "POST",
    body: JSON.stringify({ domain, auth_code: options.authCode }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Transfer failed");
    fail(data.error || data.message, { hint: data.hint, fixUrl: data.setup_url || data.payment_options?.card?.setup_url, status: res.status, json: options.json, fields: options.fields });
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
