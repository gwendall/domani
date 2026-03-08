import { publicRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";

interface Contact {
  name?: string | null;
  organization?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}

export async function whois(
  domain: string,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  requireValidDomain(domain, options);
  const s = createSpinner(!options.json);
  s.start(`Looking up ${fmt.domain(domain)}`);

  const [res, ogRes] = await Promise.all([
    publicRequest(`/api/domains/whois?q=${encodeURIComponent(domain)}`),
    publicRequest(`/api/domains/${encodeURIComponent(domain)}/og`).catch(() => null),
  ]);
  const data = await res.json();

  let og: { title?: string; description?: string; image?: string; favicon?: string } | null = null;
  try {
    if (ogRes?.ok) og = await ogRes.json();
  } catch {}

  if (!res.ok) {
    s.stop("Lookup failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop("WHOIS data retrieved");

  if (options.json) {
    jsonOut({ ...data, ...(og ? { og } : {}) }, options.fields);
    return;
  }

  heading(`WHOIS ${fmt.domain(data.domain)}`);

  if (!data.registered) {
    row("Status", `${S.success} ${pc.green("not registered")}`);
    blank();
    hintCommand("Register it:", `domani buy ${data.domain}`);
    blank();
    return;
  }

  row("Status", `${S.error} ${pc.red("registered")}`);

  if (og?.title || og?.description) {
    blank();
    console.log(`  ${pc.bold("Website preview")}`);
    console.log(`  ${pc.dim("─".repeat(50))}`);
    if (og.title) row("Title", og.title);
    if (og.description) row("Description", pc.dim(og.description.length > 80 ? og.description.slice(0, 80) + "…" : og.description));
    blank();
  }

  if (data.registrar) row("Registrar", data.registrar);
  if (data.created) row("Created", data.created);
  if (data.expires) row("Expires", data.expires);
  if (data.days_until_expiry != null) {
    const days = data.days_until_expiry;
    const color = days < 30 ? pc.red : days < 90 ? pc.yellow : pc.green;
    row("Days left", color(String(days)));
  }
  if (data.updated) row("Updated", data.updated);
  row("DNSSEC", data.dnssec ? pc.green("yes") : pc.dim("no"));

  if (data.nameservers?.length > 0) {
    row("Nameservers", data.nameservers.map((ns: string) => pc.cyan(ns)).join(pc.dim(", ")));
  }

  if (data.status?.length > 0) {
    row("Status codes", pc.dim(data.status.join(", ")));
  }

  const registrant: Contact | null = data.contacts?.registrant;
  if (registrant && !data.redacted) {
    blank();
    console.log(`  ${pc.bold("Registrant")}`);
    console.log(`  ${pc.dim("─".repeat(50))}`);
    if (registrant.name) row("Name", registrant.name);
    if (registrant.organization) row("Organization", registrant.organization);
    if (registrant.email) row("Email", fmt.url(registrant.email));
    if (registrant.country) row("Country", registrant.country);
  } else if (data.redacted) {
    row("Contact", pc.dim("redacted (WHOIS privacy)"));
  }

  blank();
}
