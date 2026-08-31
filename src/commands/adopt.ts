import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, blank, createSpinner, fmt, heading, hintCommand, jsonOut, row, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { renderExitGuidance } from "../guidance.js";

export async function adopt(
  domain: string,
  options: { json?: boolean; fields?: string },
): Promise<void> {
  requireValidDomain(domain, options);
  const spinner = createSpinner(!options.json);
  spinner.start(`Inspecting ${fmt.domain(domain)}`);
  const response = await apiRequest(`/api/domains/adoption-plan?domain=${encodeURIComponent(domain)}`);
  const plan = await response.json();
  if (!response.ok) {
    spinner.stop("Inspection failed");
    fail(plan.error || plan.message, { hint: plan.hint, status: response.status, json: options.json, fields: options.fields });
  }
  spinner.stop(`${S.success} Adoption plan ready`);

  if (options.json) {
    jsonOut(plan, options.fields);
    return;
  }

  heading(`Adopt ${fmt.domain(plan.domain)}`);
  row("Registrar", plan.current.registrar || "Unknown");
  row("DNS provider", plan.current.dns_provider);
  row("Nameservers", plan.current.nameservers.join(", ") || "None detected");
  row("DNSSEC", plan.current.dnssec_enabled ? pc.yellow("Enabled") : "Not enabled");
  row("Account", plan.account_state);
  row("Recommended", pc.cyan(plan.recommended_action));
  blank();

  if (plan.recommended_action === "connect") {
    hintCommand("Connect free, without changing registrar or DNS:", `domani import ${plan.domain}`);
  }
  if (plan.options.transfer.available) {
    const price = plan.options.transfer.price == null ? "price unavailable" : `$${plan.options.transfer.price.toFixed(2)} ${plan.options.transfer.currency}`;
    hintCommand(`Transfer registration for ${price}, preserving nameservers:`, `domani transfer ${plan.domain}`);
    if (!plan.options.transfer.eligible && plan.options.transfer.reason) {
      console.log(`  ${pc.yellow("!")} ${plan.options.transfer.reason}`);
      hintCommand("Wait for eligibility and transfer in one go:", `domani transfer ${plan.domain} --watch`);
    }
    renderExitGuidance(plan.options.transfer.guidance);
  }
  for (const warning of plan.warnings || []) console.log(`  ${pc.yellow("!")} ${warning}`);
  blank();
}
