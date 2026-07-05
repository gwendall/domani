import { apiRequest } from "../api.js";
import pc from "picocolors";
import { fmt, heading, row, blank, hint, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";

interface ProvisionResult {
  domain: string;
  domain_status: string;
  mailbox: { address: string; status: string } | null;
  webhook: { id: string; url: string; secret?: string } | null;
  warnings: string[];
  hint: string;
  next_steps: string[];
}

export async function provision(
  domain: string,
  options: {
    slug?: string;
    name?: string;
    webhook?: string;
    years?: string;
    paymentMethod?: string;
    json?: boolean;
    fields?: string;
    dryRun?: boolean;
  }
): Promise<void> {
  requireValidDomain(domain, options);

  const body: Record<string, unknown> = { domain };
  if (options.slug) body.slug = options.slug;
  if (options.name) body.name = options.name;
  if (options.webhook) body.webhook_url = options.webhook;
  if (options.years) body.years = Number(options.years);
  if (options.paymentMethod) body.payment_method = options.paymentMethod;

  if (options.dryRun) {
    dryRunOut(`POST /api/agents/provision`, body, options.json, options.fields);
    return;
  }

  const s = createSpinner(!options.json);
  s.start(`Provisioning ${fmt.domain(domain)}`);

  const res = await apiRequest("/api/agents/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ProvisionResult & { error?: string; hint?: string };

  if (!res.ok) {
    s.stop("Provisioning failed");
    fail(data.error || "Provisioning failed", {
      hint: data.hint,
      status: res.status,
      json: options.json,
      fields: options.fields,
    });
  }

  s.stop(`${fmt.domain(domain)} is ready`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  heading("Agent identity");
  row("Domain", `${data.domain} (${data.domain_status})`);
  row("Mailbox", data.mailbox ? pc.green(data.mailbox.address) : pc.yellow("pending DNS"));
  row("Webhook", data.webhook ? data.webhook.url : pc.dim("none"));
  if (data.webhook?.secret) row("Signing secret", data.webhook.secret);

  if (data.warnings?.length) {
    blank();
    for (const w of data.warnings) hint(pc.yellow(w));
  }

  if (data.next_steps?.length) {
    blank();
    heading("Next");
    for (const step of data.next_steps) hint(step);
  }
  blank();
}
