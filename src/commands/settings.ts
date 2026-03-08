import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

export async function settings(
  domain: string | undefined,
  options: { autoRenew?: string; whoisPrivacy?: string; securityLock?: string; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  const hasAutoRenew = options.autoRenew !== undefined;
  const hasPrivacy = options.whoisPrivacy !== undefined;
  const hasLock = options.securityLock !== undefined;

  // If no flags: show current settings
  if (!hasAutoRenew && !hasPrivacy && !hasLock) {
    return showSettings(domain, options.json, options.fields);
  }

  // Build request body
  const body: Record<string, boolean> = {};

  if (hasAutoRenew) {
    const val = parseToggle(options.autoRenew!);
    if (val === null) fail("--auto-renew must be on or off", { code: "validation_error", json: options.json, fields: options.fields });
    body.auto_renew = val;
  }

  if (hasPrivacy) {
    const val = parseToggle(options.whoisPrivacy!);
    if (val === null) fail("--whois-privacy must be on or off", { code: "validation_error", json: options.json, fields: options.fields });
    body.whois_privacy = val;
  }

  if (hasLock) {
    const val = parseToggle(options.securityLock!);
    if (val === null) fail("--security-lock must be on or off", { code: "validation_error", json: options.json, fields: options.fields });
    body.security_lock = val;
  }

  if (options.dryRun) {
    return dryRunOut("settings_update", { domain, ...body }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start(`Updating ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/settings`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Settings updated`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Settings Updated");
  row("Domain", fmt.domain(data.domain));
  if (data.auto_renew !== undefined) {
    row("Auto-renew", data.auto_renew ? pc.green("on") : pc.dim("off"));
  }
  if (data.whois_privacy !== undefined) {
    row("WHOIS privacy", data.whois_privacy ? pc.green("on") : pc.dim("off"));
  }
  if (data.security_lock !== undefined) {
    row("Security lock", data.security_lock ? pc.green("locked") : pc.dim("unlocked"));
  }
  if (data.hint) row("", pc.dim(data.hint));
  blank();
}

async function showSettings(domain: string, json?: boolean, fields?: string): Promise<void> {
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
    jsonOut(data, fields);
    return;
  }

  heading("Domain Settings");
  row("Domain", fmt.domain(data.domain));
  row("Status", data.status === "active" ? pc.green(data.status) : pc.yellow(data.status));
  row("Auto-renew", data.auto_renew ? pc.green("on") : pc.dim("off"));
  if (data.registrar) {
    row("WHOIS privacy", data.registrar.whois_privacy ? pc.green("on") : pc.dim("off"));
    row("Security lock", data.registrar.security_lock ? pc.green("locked") : pc.dim("unlocked"));
  }
  row("Expires", new Date(data.expires_at).toLocaleDateString() + pc.dim(` (${data.days_until_expiry} days)`));
  blank();
  hintCommand("Toggle auto-renew:", `domani settings ${domain} --auto-renew off`);
  hintCommand("Toggle WHOIS privacy:", `domani settings ${domain} --whois-privacy off`);
  hintCommand("Toggle security lock:", `domani settings ${domain} --security-lock off`);
  hintCommand("Get transfer auth code:", `domani auth-code ${domain}`);
  blank();
}

function parseToggle(val: string): boolean | null {
  const v = val.toLowerCase();
  if (v === "on" || v === "true" || v === "1" || v === "enable") return true;
  if (v === "off" || v === "false" || v === "0" || v === "disable") return false;
  return null;
}
