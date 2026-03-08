import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";

export async function importDomain(
  domain: string,
  options: { verify?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) {
    fail("Domain is required", { hint: "Usage: domani import <domain>\n       domani import <domain> --verify", code: "validation_error", json: options.json, fields: options.fields });
  }

  requireValidDomain(domain, options);
  const endpoint = options.verify
    ? "/api/domains/import/verify"
    : "/api/domains/import";

  const s = createSpinner(!options.json);
  s.start(
    options.verify
      ? `Verifying ownership of ${fmt.domain(domain)}`
      : `Initiating import for ${fmt.domain(domain)}`
  );

  const res = await apiRequest(endpoint, {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop(options.verify ? "Verification failed" : "Import failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  if (options.json) {
    s.stop("");
    jsonOut(data, options.fields);
    return;
  }

  if (options.verify) {
    s.stop(`${S.success} ${fmt.domain(domain)} imported!`);

    heading("Domain Imported");
    row("Domain", fmt.domain(data.domain));
    row("Status", pc.green(data.status || "active"));
    if (data.expires_at) row("Expires", new Date(data.expires_at).toLocaleDateString());
    if (data.registrar) row("Registrar", data.registrar);
    blank();
    hintCommand("Check domain health:", `domani status ${data.domain}`);
    blank();
  } else {
    s.stop(`${S.success} Verification record ready`);

    heading("Import Domain");
    row("Domain", fmt.domain(data.domain));
    row("Status", pc.yellow("pending verification"));
    blank();
    console.log(`  Add this TXT record at your DNS provider:`);
    blank();
    console.log(`    ${pc.dim("Type:")}  ${pc.bold("TXT")}`);
    console.log(`    ${pc.dim("Name:")}  ${pc.bold(data.txt_record?.name || "@")}`);
    console.log(`    ${pc.dim("Value:")} ${pc.bold(data.txt_record?.value || `domani-verify=${data.token}`)}`);
    blank();
    console.log(`  ${pc.dim("DNS propagation may take a few minutes to 48 hours.")}`);
    blank();
    hintCommand("Once the record is set, verify:", `domani import ${domain} --verify`);
    blank();
  }
}
