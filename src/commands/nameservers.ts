import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

export async function nameservers(
  domain: string | undefined,
  args: string[] | undefined,
  options: { set?: string; reset?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  // Collect nameservers from positional args and --set option
  const nsList: string[] = [];
  if (args?.length) nsList.push(...args);
  if (options.set) nsList.push(...options.set.split(",").map((s) => s.trim()).filter(Boolean));

  // SET mode: positional args, --set flag, or --reset
  if (nsList.length > 0 || options.reset) {
    await setNameservers(domain, nsList, options);
    return;
  }

  // GET mode (default)
  await getNameservers(domain, options);
}

async function getNameservers(domain: string, options: { json?: boolean; fields?: string }): Promise<void> {
  const s = createSpinner(!options.json);
  s.start(`Fetching nameservers for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/nameservers`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`Nameservers for ${fmt.domain(domain)}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  if (data.nameservers.length === 0) {
    console.log(`  ${S.warning} ${pc.yellow("No nameservers configured.")}`);
    console.log(`  ${pc.dim("DNS operations (parking, email, connect) will not work.")}`);
    blank();
    hintCommand("Set default nameservers:", `domani nameservers ${domain} --reset`);
  } else {
    heading("Nameservers");
    for (const ns of data.nameservers) {
      console.log(`  ${S.success} ${pc.cyan(ns)}`);
    }

    if (data.default_nameservers) {
      const isDefault = data.nameservers.length === data.default_nameservers.length &&
        data.nameservers.every((ns: string) => data.default_nameservers.includes(ns));
      if (isDefault) {
        blank();
        console.log(`  ${pc.dim("Using default nameservers.")}`);
      }
    }
  }

  if (data.default_nameservers?.length) {
    blank();
    row("Defaults", data.default_nameservers.map((ns: string) => pc.dim(ns)).join(pc.dim(", ")));
  }
  blank();
}

async function setNameservers(
  domain: string,
  nsList: string[],
  options: { reset?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  const s = createSpinner(!options.json);

  // For --reset, fetch defaults first
  if (options.reset) {
    s.start(`Fetching default nameservers for ${fmt.domain(domain)}`);
    const getRes = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/nameservers`);
    const getData = await getRes.json();

    if (!getRes.ok) {
      s.stop("Failed");
      fail(getData.error, { hint: getData.hint, status: getRes.status, json: options.json, fields: options.fields });
    }

    if (!getData.default_nameservers?.length) {
      s.stop("No defaults");
      fail("No default nameservers available for this domain's registrar.", { code: "not_found", json: options.json, fields: options.fields });
    }

    nsList = getData.default_nameservers;
    s.stop(`Using defaults: ${nsList.map((ns: string) => pc.cyan(ns)).join(pc.dim(", "))}`);
  }

  if (nsList.length < 2) {
    fail("At least 2 nameservers required.", { hint: "Example: domani nameservers example.com ns1.dns.com ns2.dns.com", code: "validation_error", json: options.json, fields: options.fields });
  }

  if (options.dryRun) {
    return dryRunOut("nameservers_set", { domain, nameservers: nsList }, options.json, options.fields);
  }

  s.start(`Setting nameservers for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/nameservers`, {
    method: "PUT",
    body: JSON.stringify({ nameservers: nsList }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Nameservers updated`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  for (const ns of data.nameservers) {
    console.log(`  ${S.success} ${pc.cyan(ns)}`);
  }
  blank();
  console.log(`  ${pc.dim("Changes may take up to 48 hours to propagate.")}`);
  blank();
  hintCommand("Check propagation:", `domani status ${domain}`);
  blank();
}
