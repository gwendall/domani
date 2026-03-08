import { apiRequest } from "../api.js";
import pc from "picocolors";
import { select, isCancel } from "@clack/prompts";
import {
  S,
  fmt,
  heading,
  row,
  blank,
  table,
  hint,
  hintCommand,
  createSpinner,
  createProgressTable,
  sleep,
  jsonOut,
  dryRunOut,
  fail,
} from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

/** Known subcommands (used for legacy detection) */
const SUBCOMMANDS = ["setup", "status", "remove", "list", "create", "delete", "send", "messages", "webhook", "forward", "check", "connect"];

/** Provider display names */
const PROVIDER_LABELS: Record<string, string> = {
  "google-workspace": "Google Workspace",
  fastmail: "Fastmail",
  proton: "Proton Mail",
};

type DnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number;
  ttl?: number;
};

interface EmailOptions {
  domain?: string;
  slug?: string;
  check?: boolean;
  dryRun?: boolean;
  json?: boolean;
  fields?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text?: string;
  url?: string;
  forwardTo?: string;
  inReplyTo?: string;
  references?: string;
  direction?: string;
  limit?: string;
}

function recordCells(r: DnsRecord): string[] {
  return [
    pc.yellow(r.type),
    r.name,
    pc.cyan(r.value) + (r.priority ? pc.dim(` pri=${r.priority}`) : ""),
  ];
}

function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] || name;
}

async function requireDomain(options: EmailOptions): Promise<string> {
  if (options.domain) {
    requireValidDomain(options.domain, options);
    return options.domain;
  }
  return pickDomain();
}

// ── Main entry ──────────────────────────────────────

export async function email(
  action: string | undefined,
  arg2: string | undefined,
  options: EmailOptions,
): Promise<void> {
  // Legacy: `domani email example.com [provider]` or `domani email example.com --check`
  if (action && action.includes(".") && !SUBCOMMANDS.includes(action)) {
    if (options.check) return checkEmailHealth(action, !!options.json, options.fields);
    if (arg2) return connectProvider(action, arg2, !!options.json, options.fields);
    return interactiveProvider(action, !!options.json, options.fields);
  }

  switch (action) {
    case undefined:
    case "list":
      return listMailboxesCli(options);
    case "setup":
      return setupEmail(options);
    case "status":
      return emailStatusCli(options);
    case "remove":
      return removeEmail(options);
    case "create":
      return createMailboxCli(options);
    case "delete":
      return deleteMailboxCli(options);
    case "send":
      return sendEmailCli(options);
    case "messages":
      return messagesCli(options);
    case "webhook":
      return webhookCli(options);
    case "forward":
      return forwardCli(options);
    case "check":
      return checkEmailHealth(options.domain || await pickDomain(), !!options.json, options.fields);
    case "connect":
      return connectProvider(options.domain || await pickDomain(), arg2 || undefined, !!options.json, options.fields);
    default:
      fail(`Unknown action: ${action}`, {
        hint: "Actions: list, setup, status, remove, create, delete, send, messages, webhook, forward, check, connect",
        code: "validation_error",
        json: options.json,
        fields: options.fields,
      });
  }
}

// ── Setup ──────────────────────────────────────────

async function setupEmail(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (options.dryRun) {
    return dryRunOut("email_setup", { domain }, options.json, options.fields);
  }
  const s = createSpinner(!options.json);
  s.start(`Setting up email on ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/email/setup`, {
    method: "POST",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Email ${data.status === "already_configured" ? "already configured" : "configured"}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (data.records?.length) {
    blank();
    heading(`Email DNS Records ${fmt.domain(domain)}`);
    const rows = data.records.map((r: { type: string; name: string; value: string; status: string }) => [
      pc.yellow(r.type),
      r.name,
      r.value.length > 40 ? r.value.slice(0, 40) + "..." : r.value,
      r.status === "verified" || r.status === "created" ? pc.green(r.status) : pc.yellow(r.status),
    ]);
    table(["Type", "Name", "Value", "Status"], rows, [8, 28, 44, 12]);
  }

  blank();
  if (data.hint) hint(data.hint);
  hintCommand("Check status:", `domani email status --domain ${domain}`);
  blank();
}

// ── Status ────────────────────────────────────────

async function emailStatusCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  const s = createSpinner(!options.json);
  s.start(`Checking email status for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/email/status`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Status loaded`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading(`Email ${fmt.domain(domain)}`);
  row("Enabled", data.enabled ? pc.green("yes") : pc.dim("no"));
  if (data.enabled) {
    row("Verified", data.verified ? pc.green("yes") : pc.yellow("pending"));
    row("Mailboxes", String(data.mailbox_count));
  }
  blank();

  if (!data.enabled) {
    hintCommand("Set up email:", `domani email setup --domain ${domain}`);
    blank();
  } else if (!data.verified && data.records?.length) {
    console.log(`  ${pc.yellow("!")} Add these DNS records to verify:`);
    for (const r of data.records) {
      console.log(`    ${pc.yellow(r.type)} ${r.name} ${pc.dim("→")} ${r.value.length > 50 ? r.value.slice(0, 50) + "..." : r.value}`);
    }
    blank();
  }
}

// ── Remove ────────────────────────────────────────

async function removeEmail(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (options.dryRun) {
    return dryRunOut("email_remove", { domain }, options.json, options.fields);
  }
  const s = createSpinner(!options.json);
  s.start(`Removing email from ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/email/setup`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Email disabled`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (data.mailboxes_deleted > 0) {
    console.log(`  ${pc.dim(`${data.mailboxes_deleted} mailbox(es) deleted.`)}`);
  }
  blank();
}

// ── List mailboxes ────────────────────────────────

async function listMailboxesCli(options: EmailOptions): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading mailboxes");

  const path = options.domain
    ? `/api/domains/${encodeURIComponent(options.domain)}/email`
    : "/api/email";
  const res = await apiRequest(path);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const mboxes = data.mailboxes || [];
  s.stop(`${S.success} ${mboxes.length} mailbox(es)`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (mboxes.length === 0) {
    blank();
    console.log(`  ${pc.dim("No mailboxes.")}`);
    blank();
    hintCommand("Create one:", "domani email create --domain example.com --slug hello");
    blank();
    return;
  }

  blank();
  heading("Mailboxes");
  const rows = mboxes.map((m: { address: string; message_count: number; webhook_url: string | null; created_at: string }) => [
    pc.cyan(m.address),
    String(m.message_count),
    m.webhook_url ? fmt.url(m.webhook_url) : pc.dim("-"),
    pc.dim(new Date(m.created_at).toLocaleDateString()),
  ]);
  table(["Address", "Messages", "Webhook", "Created"], rows, [32, 10, 36, 14]);
  blank();
}

// ── Create mailbox ────────────────────────────────

async function createMailboxCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (options.dryRun) {
    return dryRunOut("email_create_mailbox", { domain, slug: options.slug }, options.json, options.fields);
  }
  const s = createSpinner(!options.json);
  s.start("Creating mailbox");

  const body: Record<string, string> = {};
  if (options.slug) body.slug = options.slug;

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/email`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Mailbox created`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Mailbox Created");
  row("Address", pc.cyan(data.address));
  row("Domain", data.domain);
  if (data.webhook_url) row("Webhook", fmt.url(data.webhook_url));
  blank();
}

// ── Delete mailbox ────────────────────────────────

async function deleteMailboxCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email delete --domain example.com --slug hello", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (options.dryRun) {
    return dryRunOut("email_delete_mailbox", { domain, address: `${options.slug}@${domain}` }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start(`Deleting ${options.slug}@${domain}`);

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/email/${encodeURIComponent(options.slug)}`,
    { method: "DELETE" },
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Mailbox deleted`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  console.log(`  ${pc.dim(`${data.address} and all messages deleted.`)}`);
  blank();
}

// ── Send email ────────────────────────────────────

async function sendEmailCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email send --domain example.com --slug hello --to user@test.com --subject Hi --text Hello", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (!options.to) {
    fail("Recipient required", { hint: "Usage: domani email send --domain example.com --slug hello --to user@test.com", code: "validation_error", json: options.json, fields: options.fields });
  }

  if (options.dryRun) {
    return dryRunOut("email_send", {
      from: `${options.slug}@${domain}`,
      to: options.to,
      subject: options.subject,
    }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start(`Sending from ${options.slug}@${domain}`);

  const body: Record<string, unknown> = { to: options.to };
  if (options.cc) body.cc = options.cc;
  if (options.bcc) body.bcc = options.bcc;
  if (options.subject) body.subject = options.subject;
  if (options.text) body.text = options.text;
  if (options.inReplyTo) body.in_reply_to = options.inReplyTo;
  if (options.references) body.references = options.references;

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/email/${encodeURIComponent(options.slug)}/send`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Email sent`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Email Sent");
  row("From", data.from);
  row("To", data.to);
  if (data.subject) row("Subject", data.subject);
  row("Status", pc.green(data.status));
  blank();
}

// ── List messages ─────────────────────────────────

async function messagesCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email messages --domain example.com --slug hello [--direction in|out] [--limit 20]", code: "validation_error", json: options.json, fields: options.fields });
  }

  const params = new URLSearchParams();
  if (options.direction) params.set("direction", options.direction);
  if (options.limit) params.set("limit", options.limit);
  const qs = params.toString() ? `?${params}` : "";

  const s = createSpinner(!options.json);
  s.start(`Loading messages for ${options.slug}@${domain}`);

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/email/${encodeURIComponent(options.slug)}/messages${qs}`,
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const msgs = data.messages || [];
  s.stop(`${S.success} ${msgs.length} message(s)`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (msgs.length === 0) {
    blank();
    console.log(`  ${pc.dim("No messages.")}`);
    blank();
    return;
  }

  blank();
  heading(`Messages ${options.slug}@${domain}`);
  const rows = msgs.map((m: { direction: string; from: string; to: string; subject: string | null; created_at: string }) => [
    m.direction === "in" ? pc.green("in") : pc.blue("out"),
    m.direction === "in" ? m.from : m.to,
    m.subject ? (m.subject.length > 30 ? m.subject.slice(0, 30) + "..." : m.subject) : pc.dim("(no subject)"),
    pc.dim(new Date(m.created_at).toLocaleString()),
  ]);
  table(["Dir", "From/To", "Subject", "Date"], rows, [5, 28, 34, 22]);
  if (data.next_cursor) {
    blank();
    hint(`More messages available. Use --limit to paginate.`);
  }
  blank();
}

// ── Set webhook ──────────────────────────────────

async function webhookCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email webhook --domain example.com --slug hello --url https://...", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (options.dryRun) {
    return dryRunOut("email_webhook", {
      address: `${options.slug}@${domain}`,
      webhook_url: options.url || null,
    }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start(`Updating webhook for ${options.slug}@${domain}`);

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/email/${encodeURIComponent(options.slug)}`,
    { method: "PATCH", body: JSON.stringify({ webhook_url: options.url || null }) },
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Webhook ${options.url ? "set" : "removed"}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading(`Mailbox ${data.address}`);
  row("Webhook", data.webhook_url ? fmt.url(data.webhook_url) : pc.dim("none"));
  blank();
}

// ── Set forward ─────────────────────────────────

async function forwardCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email forward --domain example.com --slug hello --forward-to me@gmail.com", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (options.dryRun) {
    return dryRunOut("email_forward", {
      address: `${options.slug}@${domain}`,
      forward_to: options.forwardTo || null,
    }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  const forwardTo = options.forwardTo || null;
  s.start(`Updating forward for ${options.slug}@${domain}`);

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/email/${encodeURIComponent(options.slug)}`,
    { method: "PATCH", body: JSON.stringify({ forward_to: forwardTo }) },
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Forward ${forwardTo ? "set" : "removed"}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading(`Mailbox ${data.address}`);
  row("Forward to", data.forward_to ? pc.cyan(data.forward_to) : pc.dim("none"));
  blank();
}

// ── Health check (legacy) ────────────────────────

async function checkEmailHealth(domain: string, json: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start(`Checking email health for ${fmt.domain(domain)}`);

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/email/check`
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop("Email health checked");

  if (json) {
    jsonOut(data, fields);
    return;
  }

  heading(`Email Health ${fmt.domain(data.domain)}`);

  if (data.provider) {
    row("Provider", pc.cyan(providerLabel(data.provider)));
  } else {
    row("Provider", pc.dim("unknown"));
  }

  if (data.mx.configured) {
    row(
      "MX",
      `${S.success} ${pc.green("propagated")} ${pc.dim(`(${data.mx.records.length} record${data.mx.records.length !== 1 ? "s" : ""})`)}`
    );
  } else {
    row("MX", `${S.error} ${pc.red("not configured")}`);
  }

  if (data.spf.configured) {
    row("SPF", `${S.success} ${pc.green(data.spf.value)}`);
  } else {
    row("SPF", `${S.error} ${pc.red("missing")}`);
  }

  if (data.dmarc.configured) {
    const val =
      data.dmarc.value.length > 50
        ? data.dmarc.value.slice(0, 50) + "..."
        : data.dmarc.value;
    row("DMARC", `${S.success} ${pc.green(val)}`);
  } else {
    row("DMARC", `${S.error} ${pc.red("missing")}`);
  }

  if (data.dkim.configured) {
    row(
      "DKIM",
      `${S.success} ${pc.green("found")} ${pc.dim(`(${data.dkim.selectors.join(", ")})`)}`
    );
  } else {
    row("DKIM", `${S.warning} ${pc.yellow("not found")}`);
  }

  blank();

  if (!data.mx.configured) {
    hintCommand("Set up email:", `domani email ${domain} google`);
    blank();
  } else if (!data.spf.configured || !data.dmarc.configured) {
    hint(
      "SPF and DMARC protect against email spoofing. Re-run email setup to add them."
    );
    blank();
  }
}

// ── Provider connect (legacy) ────────────────────

async function connectProvider(domain: string, provider: string | undefined, json: boolean, fields?: string): Promise<void> {
  if (provider) {
    return setupProviderDns(domain, provider, json, fields);
  }
  return interactiveProvider(domain, json, fields);
}

async function interactiveProvider(domain: string, json: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start("Loading email providers");

  const res = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/connect`
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop("Providers loaded");

  const providers = data.providers?.email || [];
  if (providers.length === 0) {
    fail("No email providers available", { code: "not_found", json, fields });
  }

  const selected = await select({
    message: "Choose an email provider",
    options: providers.map((p: { name: string }) => ({
      value: p.name,
      label: providerLabel(p.name),
    })),
  });

  if (isCancel(selected)) {
    process.exit(0);
  }

  return setupProviderDns(domain, selected as string, json, fields);
}

async function setupProviderDns(
  domain: string,
  provider: string,
  json: boolean,
  fields?: string
): Promise<void> {
  if (json) {
    const res = await apiRequest(
      `/api/domains/${encodeURIComponent(domain)}/connect`,
      { method: "POST", body: JSON.stringify({ target: provider }) }
    );
    const data = await res.json();
    if (!res.ok) {
      fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
    }
    jsonOut(data, fields);
    return;
  }

  const previewRes = await apiRequest(
    `/api/domains/${encodeURIComponent(domain)}/connect?provider=${encodeURIComponent(provider)}`
  );
  if (!previewRes.ok) {
    const data = await previewRes.json();
    fail(data.error || data.message, { hint: data.hint, status: previewRes.status, json, fields });
  }
  const previewData = await previewRes.json();
  const records: DnsRecord[] = previewData.preview?.records ?? [];
  const resolvedProvider = previewData.preview?.provider ?? provider;
  const label = providerLabel(resolvedProvider);

  heading(`Email ${fmt.domain(domain)}`);
  row("Provider", pc.cyan(label));

  if (records.length) {
    blank();
    console.log(`  ${pc.bold("DNS Records")}`);

    const colWidths = [8, 24, 40];
    const pt = createProgressTable(
      ["Type", "Name", "Value"],
      records.map((r) => ({ cells: recordCells(r), status: "pending" as const })),
      colWidths
    );
    pt.start();

    const res = await apiRequest(
      `/api/domains/${encodeURIComponent(domain)}/connect`,
      { method: "POST", body: JSON.stringify({ target: provider }) }
    );
    const data = await res.json();

    if (!res.ok) {
      pt.stop();
      blank();
      fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
    }

    const resultRecords = data.records || [];
    for (let i = 0; i < records.length; i++) {
      const match = resultRecords.find(
        (rr: { record: DnsRecord; status: string }) =>
          rr.record.type === records[i].type &&
          rr.record.name === records[i].name &&
          rr.record.value === records[i].value
      );
      if (match?.status === "already_set") {
        pt.markDone(i);
      } else {
        await sleep(60);
        pt.markDone(i);
      }
    }
    await sleep(80);
    pt.stop();

    const created = resultRecords.filter((r: { status: string }) => r.status === "created" || r.status === "updated").length;
    const alreadySet = resultRecords.filter((r: { status: string }) => r.status === "already_set").length;
    let summary: string;
    if (alreadySet === resultRecords.length) {
      summary = `All ${alreadySet} records already set`;
    } else if (alreadySet > 0) {
      summary = `${created} created, ${alreadySet} already set`;
    } else {
      summary = `${created} DNS records set`;
    }

    blank();
    console.log(`  ${S.success} ${pc.green(`Email configured - ${summary}`)}`);
  } else {
    const s = createSpinner(true);
    s.start("Setting DNS records");

    const res = await apiRequest(
      `/api/domains/${encodeURIComponent(domain)}/connect`,
      { method: "POST", body: JSON.stringify({ target: provider }) }
    );
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
    }

    s.stop(`${S.success} Email configured via ${pc.cyan(label)}`);
  }

  blank();
  hintCommand("Verify propagation:", `domani email ${domain} --check`);
  blank();
}
