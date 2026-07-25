import { apiRequest } from "../api.js";
import { APP_URL } from "../brand.js";
import pc from "picocolors";
import { select, text, isCancel } from "@clack/prompts";
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
const SUBCOMMANDS = ["setup", "status", "remove", "list", "create", "delete", "send", "inbox", "folders", "archive", "trash", "restore", "read", "unread", "star", "unstar", "webhook", "forward", "check", "connect", "work", "triage", "notes", "note", "activity", "changes"];

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
  title?: string;
  text?: string;
  url?: string;
  forwardTo?: string;
  inReplyTo?: string;
  references?: string;
  direction?: string;
  folder?: string;
  view?: string;
  messageIds?: string;
  limit?: string;
  cursor?: string;
  body?: string;
  from?: string;
  mailboxIds?: string;
  threadKey?: string;
  threadAliases?: string;
  status?: string;
  assigned?: string;
  assigneeType?: string;
  assigneeId?: string;
  conversationId?: string;
  note?: string;
  version?: string;
  workspace?: string;
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

/**
 * Split a comma-separated recipient string into a trimmed, de-blanked list.
 * The send API accepts a single email string OR an array; a raw
 * "a@x.com,b@y.com" string fails email validation, so multi-recipient
 * to/cc/bcc must go over the wire as an array.
 */
export function parseRecipients(value?: string): string[] {
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Wire form for a recipient field: single string when one, array when many. */
export function recipientField(list: string[]): string | string[] | undefined {
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

/** Parse "user@domain" from arg2 into options.slug and options.domain */
function parseEmailArg(arg2: string | undefined, options: EmailOptions): void {
  if (arg2 && arg2.includes("@")) {
    const [slug, domain] = arg2.split("@", 2);
    if (!options.slug && slug) options.slug = slug;
    if (!options.domain && domain) options.domain = domain;
  }
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

  // Parse user@domain shorthand from arg2 (e.g. `domani email create hello@example.com`)
  parseEmailArg(arg2, options);

  // --body is alias for --text, --title is alias for --subject
  if (options.body && !options.text) options.text = options.body;
  if (options.title && !options.subject) options.subject = options.title;
  // --from user@domain is alias for --domain + --slug
  if (options.from && options.from.includes("@")) {
    const [slug, domain] = options.from.split("@", 2);
    if (!options.slug && slug) options.slug = slug;
    if (!options.domain && domain) options.domain = domain;
  }

  switch (action) {
    case undefined:
      return listMailboxesCli(options);
    case "list":
      return listMailboxesCli(options);
    case "inbox":
      return messagesCli(options);
    case "folders":
      return foldersCli(options);
    case "archive":
    case "trash":
    case "restore":
    case "read":
    case "unread":
    case "star":
    case "unstar":
      return lifecycleActionCli(action, options);
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
    case "webhook":
      return webhookCli(options);
    case "forward":
      return forwardCli(options);
    case "work":
      return collaborationListCli(options);
    case "triage":
      return collaborationUpdateCli(options);
    case "note":
      return collaborationNoteCli(options);
    case "notes":
      return collaborationNotesCli(options);
    case "activity":
      return collaborationActivityCli(options);
    case "changes":
      return mailboxChangesCli(options);
    case "check":
      return checkEmailHealth(options.domain || await pickDomain(), !!options.json, options.fields);
    case "connect":
      return connectProvider(options.domain || await pickDomain(), arg2 || undefined, !!options.json, options.fields);
    default:
      fail(`Unknown action: ${action}`, {
        hint: "Actions: list, inbox, folders, archive, trash, restore, read, unread, star, unstar, create, delete, send, forward, webhook, work, triage, notes, note, activity, changes, setup, status, check, connect",
        code: "validation_error",
        json: options.json,
        fields: options.fields,
      });
  }
}

async function mailboxChangesCli(options: EmailOptions): Promise<void> {
  const mailboxId = options.mailboxIds?.split(",").map((value) => value.trim()).filter(Boolean)[0];
  if (!mailboxId) fail("Mailbox ID required", { hint: "Usage: domani email changes --mailbox-ids mb_1 [--cursor <opaque>]", code: "validation_error", json: options.json, fields: options.fields });
  const params = new URLSearchParams({ mailbox_id: mailboxId });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", options.limit);
  const response = await apiRequest(`/api/email/changes?${params}`);
  const data = await response.json();
  if (!response.ok) fail(data.error || data.message, { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  heading("Mailbox Changes");
  if (data.requires_full_sync) {
    row("Full sync", "Required");
    row("Baseline cursor", data.next_cursor);
    hint("Take a bounded mailbox snapshot, then call this command again with --cursor to replay concurrent changes.");
    return;
  }
  if (!data.changes.length) console.log(`  ${pc.dim("No changes since this cursor.")}`);
  else table(["Sequence", "Type", "Resource", "Created"], data.changes.map((item: { sequence: string; type: string; resource_type: string; resource_id: string | null; created_at: string }) => [
    item.sequence,
    item.type,
    `${item.resource_type}:${item.resource_id || "-"}`,
    item.created_at,
  ]), [12, 32, 40, 24]);
  row("Next cursor", data.next_cursor);
  if (data.has_more) hint("More changes are available; call again with the next cursor.");
}

async function collaborationListCli(options: EmailOptions): Promise<void> {
  const mailboxIds = (options.mailboxIds || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!mailboxIds.length) fail("Mailbox IDs required", { hint: "Usage: domani email work --mailbox-ids mb_1,mb_2", code: "validation_error", json: options.json, fields: options.fields });
  const params = new URLSearchParams({ mailbox_ids: mailboxIds.join(",") });
  if (options.status) params.set("status", options.status);
  if (options.assigned) params.set("assigned", options.assigned);
  if (options.limit) params.set("limit", options.limit);
  const response = await apiRequest(`/api/email/work-queue?${params}`);
  const data = await response.json();
  if (!response.ok) fail(data.error || data.message, { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  heading("Shared Inbox Work");
  if (!data.items.length) return console.log(`  ${pc.dim("No conversations match this queue.")}`);
  table(["Thread", "Status", "Assignee", "Subject"], data.items.map((item: { thread_key: string; status: string; assignee: { label: string } | null; subject: string | null }) => [item.thread_key, item.status, item.assignee?.label || "Unassigned", item.subject || "(no subject)"]), [28, 10, 28, 48]);
  if (data.partial) hint("This is a bounded snapshot. Increase --limit or use the API scan_limit when you need a wider queue.");
}

async function collaborationUpdateCli(options: EmailOptions): Promise<void> {
  if (!options.mailboxIds || !options.threadKey) fail("Mailbox ID and thread key required", { hint: "Usage: domani email triage --mailbox-ids mb_1 --thread-key <key> --status closed", code: "validation_error", json: options.json, fields: options.fields });
  const assignee = options.assigneeId && options.assigneeType ? { type: options.assigneeType, id: options.assigneeId } : undefined;
  const response = await apiRequest("/api/email/collaboration", {
    method: "PATCH",
    body: JSON.stringify({
      mailbox_id: options.mailboxIds.split(",")[0],
      thread_key: options.threadKey,
      thread_aliases: options.threadAliases?.split(",").map((value) => value.trim()).filter(Boolean),
      status: options.status,
      assignee,
      version: options.version ? Number.parseInt(options.version, 10) : undefined,
    }),
  });
  const data = await response.json();
  if (!response.ok) fail(data.error || data.message, { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  heading("Conversation Updated"); row("Status", data.status); row("Assignee", data.assignee?.label || "Unassigned"); row("Version", data.version);
}

async function collaborationNoteCli(options: EmailOptions): Promise<void> {
  if (!options.conversationId || !options.note) fail("Conversation ID and note required", { hint: "Usage: domani email note --conversation-id conv_1 --note \"Waiting for finance\"", code: "validation_error", json: options.json, fields: options.fields });
  const response = await apiRequest(`/api/email/collaboration/${encodeURIComponent(options.conversationId)}/notes`, { method: "POST", body: JSON.stringify({ body: options.note }) });
  const data = await response.json();
  if (!response.ok) fail(data.error || data.message, { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  console.log(`${S.success} Private note added`);
}

async function collaborationNotesCli(options: EmailOptions): Promise<void> {
  if (!options.conversationId) fail("Conversation ID required", { hint: "Usage: domani email notes --conversation-id conv_1", code: "validation_error", json: options.json, fields: options.fields });
  const response = await apiRequest(`/api/email/collaboration/${encodeURIComponent(options.conversationId)}/notes`);
  const data = await response.json();
  if (!response.ok) fail(data.error || data.message, { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  heading("Private Notes");
  if (!data.notes.length) return console.log(`  ${pc.dim("No private notes yet.")}`);
  table(["Author", "Created", "Note"], data.notes.map((item: { author: { label: string }; created_at: string; body: string }) => [item.author.label, item.created_at, item.body]), [28, 24, 64]);
}

async function collaborationActivityCli(options: EmailOptions): Promise<void> {
  if (!options.conversationId) fail("Conversation ID required", { hint: "Usage: domani email activity --conversation-id conv_1", code: "validation_error", json: options.json, fields: options.fields });
  const response = await apiRequest(`/api/email/collaboration/${encodeURIComponent(options.conversationId)}/activity`);
  const data = await response.json();
  if (!response.ok) fail(data.error || data.message, { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  heading("Conversation Activity");
  if (!data.activity.length) return console.log(`  ${pc.dim("No activity yet.")}`);
  table(["Type", "Actor", "Created"], data.activity.map((item: { type: string; actor: { label: string }; created_at: string }) => [item.type, item.actor.label, item.created_at]), [36, 32, 24]);
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

  const params = options.domain ? `?domain=${encodeURIComponent(options.domain)}` : "";
  const res = await apiRequest(`/api/emails${params}`);
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
    hintCommand("Create one:", "domani email create hello@example.com");
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
    return dryRunOut("email_create_mailbox", { domain, slug: options.slug, workspace_id: options.workspace }, options.json, options.fields);
  }

  let slug = options.slug;
  if (!slug && !options.json) {
    const input = await text({ message: `Email handle for @${domain}:`, placeholder: "hello" });
    if (isCancel(input)) process.exit(0);
    slug = input as string;
  }
  if (!slug) {
    fail("Slug required", { hint: `Usage: domani email create hello@${domain}`, code: "validation_error", json: options.json, fields: options.fields });
  }
  const address = `${slug}@${domain}`;

  const s = createSpinner(!options.json);
  s.start("Creating mailbox");

  let res = await apiRequest(`/api/emails`, {
    method: "POST",
    body: JSON.stringify({ address, workspace_id: options.workspace }),
  });
  let data = await res.json();

  // Domain not in account → show records + per-record progress tracking
  if (res.status === 202 && !options.json) {
    s.stop("");

    type DnsRecord = { type: string; name: string; value: string; priority?: number; note?: string };
    const txtRecord = data.txt_record;
    const emailRecords: DnsRecord[] = data.email_records || [];
    const allRecords: DnsRecord[] = [
      { type: "TXT", name: txtRecord?.name || "@", value: txtRecord?.value || "", note: "ownership proof" },
      ...emailRecords,
    ];

    // Show full values (copyable)
    blank();
    console.log(`  Add these records at your DNS provider:`);
    blank();
    for (const r of allRecords) {
      const pri = r.priority !== undefined ? `  ${pc.dim(`priority: ${r.priority}`)}` : "";
      const note = r.note ? `  ${pc.dim(`(${r.note})`)}` : "";
      console.log(`  ${pc.yellow(r.type)}  ${pc.bold(r.name)}${pri}${note}`);
      console.log(`  ${pc.dim("→")} ${pc.cyan(r.value)}`);
      blank();
    }
    hint("DNS propagation typically takes 5–30 minutes. Checking automatically...");
    blank();

    // Progress table — one row per record, updated individually
    const ptRows = allRecords.map((r) => ({
      cells: [pc.yellow(r.type), r.name, r.note ? pc.dim(`(${r.note})`) : ""],
      status: "pending" as const,
    }));
    const pt = createProgressTable(["Type", "Name", ""], ptRows, [6, 24, 16]);
    pt.start();

    // Phase 1: poll ownership (TXT) via POST /api/emails
    let attempts = 0;
    while (res.status === 202 && attempts < 60) {
      await sleep(15000);
      attempts++;
      res = await apiRequest(`/api/emails`, { method: "POST", body: JSON.stringify({ address, workspace_id: options.workspace }) });
      data = await res.json();
      if (res.status !== 202 && !res.ok) {
        pt.stop();
        fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
      }
    }
    if (res.status === 202) {
      pt.stop();
      fail("TXT record not detected after 15 minutes.", {
        hint: `Check the record is set, then retry: domani email create ${address}`,
        code: "timeout", json: options.json, fields: options.fields,
      });
    }
    // TXT ownership verified → mark first row done
    pt.markDone(0);

    // Phase 2: poll email DNS per-record via email/status
    const recordKey = (r: { type: string; name: string }) => `${r.type}:${r.name}`;
    const rowByKey = new Map<string, number>();
    allRecords.slice(1).forEach((r, i) => rowByKey.set(recordKey(r), i + 1));

    for (let i = 0; i < 60; i++) {
      await sleep(15000);
      const stRes = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/email/status`);
      const stData = await stRes.json();
      if (stRes.ok && stData.records) {
        for (const r of stData.records) {
          if (r.status === "verified" || r.status === "created") {
            const idx = rowByKey.get(recordKey(r));
            if (idx !== undefined) pt.markDone(idx);
          }
        }
      }
      if (stRes.ok && stData.verified) break;
    }
    pt.stop();
    blank();
  }

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} ${pc.cyan(data.address)} created`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  // Check if email DNS is fully propagated
  const statusRes = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/email/status`);
  const statusData = await statusRes.json();
  blank();
  if (statusRes.ok && statusData.verified) {
    hintCommand("Read inbox:", `domani email inbox ${data.address}`);
    hintCommand("Web inbox:", `${APP_URL}/inbox?address=${encodeURIComponent(data.address)}`);
  } else {
    hintCommand("Check propagation:", `domani email status --domain ${domain}`);
    hintCommand("Web inbox:", `${APP_URL}/inbox?address=${encodeURIComponent(data.address)}`);
  }

  blank();
}

// ── Delete mailbox ────────────────────────────────

async function deleteMailboxCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email delete hello@example.com", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (options.dryRun) {
    return dryRunOut("email_delete_mailbox", { domain, address: `${options.slug}@${domain}` }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start(`Deleting ${options.slug}@${domain}`);

  const address = encodeURIComponent(`${options.slug}@${domain}`);
  const res = await apiRequest(
    `/api/emails/${address}`,
    { method: "DELETE", body: JSON.stringify({ confirm: true }) },
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
    fail("Slug required", { hint: "Usage: domani email send hello@example.com --to user@test.com --subject \"Hi\" --body \"Hello\"", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (!options.to) {
    fail("Recipient required", { hint: "Usage: domani email send hello@example.com --to user@test.com", code: "validation_error", json: options.json, fields: options.fields });
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

  // Comma-separated to/cc/bcc go over the wire as arrays (see parseRecipients).
  const body: Record<string, unknown> = { to: recipientField(parseRecipients(options.to)) };
  const cc = recipientField(parseRecipients(options.cc));
  const bcc = recipientField(parseRecipients(options.bcc));
  if (cc) body.cc = cc;
  if (bcc) body.bcc = bcc;
  if (options.subject) body.subject = options.subject;
  if (options.text) body.text = options.text;
  if (options.inReplyTo) body.in_reply_to = options.inReplyTo;
  if (options.references) body.references = options.references;

  const sendAddress = encodeURIComponent(`${options.slug}@${domain}`);
  const res = await apiRequest(
    `/api/emails/${sendAddress}/send`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    const hint = data.code === "MONTHLY_LIMIT_EXCEEDED"
      ? `Run ${pc.cyan("domani upgrade")} to switch to Pro (10,000 emails/month).`
      : data.hint;
    fail(data.error || data.message, { hint, status: res.status, json: options.json, fields: options.fields });
  }

  const toStr = Array.isArray(data.to) ? data.to.join(", ") : data.to;
  s.stop(`${S.success} Sent to ${pc.cyan(toStr)}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }
}

// ── List messages ─────────────────────────────────

async function messagesCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email inbox hello@example.com [--direction in|out] [--limit 20]", code: "validation_error", json: options.json, fields: options.fields });
  }

  const params = new URLSearchParams();
  if (options.direction) params.set("direction", options.direction);
  if (options.folder) params.set("folder", options.folder);
  if (options.view) params.set("view", options.view);
  if (options.limit) params.set("limit", options.limit);
  const qs = params.toString() ? `?${params}` : "";

  const s = createSpinner(!options.json);
  s.start(`Loading messages for ${options.slug}@${domain}`);

  const inboxAddress = encodeURIComponent(`${options.slug}@${domain}`);
  const res = await apiRequest(
    `/api/emails/${inboxAddress}/messages${qs}`,
  );
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const msgs = data.messages || [];

  if (options.json) {
    s.stop(`${S.success} ${msgs.length} message(s)`);
    jsonOut(data, options.fields);
    return;
  }

  if (msgs.length === 0) {
    s.stop(`${pc.dim("No messages")}`);
    return;
  }

  const plural = msgs.length > 1 ? "s" : "";
  s.stop(`${S.success} ${pc.cyan(`${options.slug}@${domain}`)} ${pc.dim("· " + msgs.length + " message" + plural)}`);

  for (const m of msgs as { direction: string; from: string; to: string; subject: string | null; text: string | null; created_at: string }[]) {
    const dir = m.direction === "in" ? pc.green("in ") : pc.dim("out");
    const contact = m.direction === "in" ? m.from : m.to;
    const rawSubject = m.subject || "(no subject)";
    const date = pc.dim(new Date(m.created_at).toLocaleString());
    let titlePart = rawSubject;
    if (m.text) {
      const preview = m.text.replace(/\s+/g, " ").trim();
      const snippet = preview.length > 60 ? preview.slice(0, 60) + "…" : preview;
      titlePart = `${rawSubject} ${pc.dim("- " + snippet)}`;
    }
    console.log(`  ${dir}  ${contact.padEnd(30)} ${titlePart}  ${date}`);
  }

  if (data.next_cursor) {
    console.log(`  ${pc.dim("… more available, use --limit to paginate")}`);
  }
}

async function foldersCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) fail("Slug required", { hint: "Usage: domani email folders hello@example.com", code: "validation_error", json: options.json, fields: options.fields });
  const address = encodeURIComponent(`${options.slug}@${domain}`);
  const res = await apiRequest(`/api/emails/${address}/folders`);
  const data = await res.json();
  if (!res.ok) fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  heading(`Folders for ${options.slug}@${domain}`);
  for (const folder of data.folders || []) row(folder.id, `${folder.total} total, ${folder.unread} unread`);
  for (const view of data.views || []) row(view.id, `${view.total} total, ${view.unread} unread`);
}

async function lifecycleActionCli(action: string, options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) fail("Slug required", { hint: `Usage: domani email ${action} hello@example.com --message-ids id1,id2`, code: "validation_error", json: options.json, fields: options.fields });
  const messageIds = (options.messageIds || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!messageIds.length) fail("Message IDs required", { hint: "Pass --message-ids id1,id2", code: "validation_error", json: options.json, fields: options.fields });
  const body: Record<string, unknown> = { message_ids: messageIds };
  if (action === "archive" || action === "trash") Object.assign(body, { action: "move", destination: action === "archive" ? "archive" : "trash" });
  if (action === "restore") body.action = "restore";
  if (action === "read" || action === "unread") Object.assign(body, { action: "mark_read", read: action === "read" });
  if (action === "star" || action === "unstar") Object.assign(body, { action: "star", starred: action === "star" });
  if (options.dryRun) return dryRunOut("email_messages_action", { address: `${options.slug}@${domain}`, ...body }, options.json, options.fields);
  const address = encodeURIComponent(`${options.slug}@${domain}`);
  const res = await apiRequest(`/api/emails/${address}/messages/actions`, { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok && res.status !== 207) fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  const succeeded = (data.results || []).filter((result: { ok: boolean }) => result.ok).length;
  const failed = (data.results || []).length - succeeded;
  console.log(`${S.success} ${succeeded} updated${failed ? pc.yellow(`, ${failed} failed`) : ""}`);
}

// ── Set webhook ──────────────────────────────────

async function webhookCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email webhook hello@example.com --url https://...", code: "validation_error", json: options.json, fields: options.fields });
  }

  const address = `${options.slug}@${domain}`;
  const encodedAddress = encodeURIComponent(address);

  if (options.dryRun) {
    return dryRunOut("email_webhook", {
      address,
      webhook_url: options.url || null,
    }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);

  if (options.url) {
    s.start(`Setting webhook for ${address}`);
    const res = await apiRequest(
      `/api/emails/${encodedAddress}/webhook`,
      { method: "PUT", body: JSON.stringify({ url: options.url }) },
    );
    const data = await res.json();
    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }
    s.stop(`${S.success} Webhook set`);
    if (options.json) { jsonOut(data, options.fields); return; }
    heading(`Mailbox ${data.address}`);
    row("Webhook", fmt.url(data.webhook_url));
    row("Signing secret", pc.dim(data.signing_secret));
    blank();
  } else {
    s.start(`Removing webhook for ${address}`);
    const res = await apiRequest(
      `/api/emails/${encodedAddress}/webhook`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }
    s.stop(`${S.success} Webhook removed`);
    if (options.json) { jsonOut(data, options.fields); return; }
    heading(`Mailbox ${data.address}`);
    row("Webhook", pc.dim("none"));
    blank();
  }
}

// ── Set forward ─────────────────────────────────

async function forwardCli(options: EmailOptions): Promise<void> {
  const domain = await requireDomain(options);
  if (!options.slug) {
    fail("Slug required", { hint: "Usage: domani email forward hello@example.com --forward-to me@gmail.com", code: "validation_error", json: options.json, fields: options.fields });
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

  const fwdAddress = encodeURIComponent(`${options.slug}@${domain}`);
  const res = await apiRequest(
    `/api/emails/${fwdAddress}`,
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
