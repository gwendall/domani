import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

export async function authCode(
  domain: string | undefined,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  const s = createSpinner(!options.json);
  s.start(`Getting auth code for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/auth-code`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Auth code retrieved`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Auth Code");
  row("Domain", fmt.domain(data.domain));
  row("Auth code", pc.bold(pc.green(data.auth_code)));
  if (data.was_unlocked) {
    row("", pc.yellow("Domain was automatically unlocked to allow transfer."));
  }
  if (data.hint) {
    blank();
    console.log(`  ${pc.dim(data.hint)}`);
  }
  if (data.next_steps?.length) {
    blank();
    for (const step of data.next_steps) {
      console.log(`  ${pc.dim("→")} ${pc.dim(step)}`);
    }
  }
  blank();
  hintCommand("Check transfer status:", `domani transfer-away ${domain}`);
  hintCommand("Re-lock domain:", `domani settings ${domain} --security-lock on`);
  blank();
}
