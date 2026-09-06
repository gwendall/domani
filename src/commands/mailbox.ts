import { apiRequest } from "../api.js";
import pc from "picocolors";
import { fail, heading, hint, jsonOut, openUrl, row, sleep } from "../ui.js";

interface MailboxOptions {
  json?: boolean;
  fields?: string;
  address?: string;
  since?: string;
  window?: string;
  workspace?: string;
  open?: boolean;
  wait?: boolean;
}

export const MAILBOX_ACTIONS = ["connect", "connector", "import", "verify", "disconnect"] as const;

export class MailboxUsageError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = "MailboxUsageError";
  }
}

/** Pure: the request a mailbox action makes; tested without the network. */
export function buildMailboxRequest(action: string | undefined, target: string | undefined, options: MailboxOptions): { path: string; method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> } {
  switch (action) {
    case "connect": {
      if (target === "forwarding") {
        if (!options.address) throw new MailboxUsageError("--address is required.", "domani mailbox connect forwarding --address someone@gmail.com");
        return { path: "/api/emails/connect/forwarding", method: "POST", body: { address: options.address, ...(options.workspace ? { workspace_id: options.workspace } : {}) } };
      }
      if ((target ?? "gmail") !== "gmail") throw new MailboxUsageError(`Unknown provider "${target}".`, "gmail (the API) or forwarding (a rule at any provider); outlook follows.");
      if (options.since && options.window) throw new MailboxUsageError("Use --since or --window, not both.");
      return { path: "/api/emails/connect/gmail", method: "POST", body: { ...(options.since ? { since: options.since } : {}), ...(options.window ? { window: options.window } : {}), ...(options.workspace ? { workspace_id: options.workspace } : {}) } };
    }
    case "connector":
      if (!target) throw new MailboxUsageError("Address required.", "domani mailbox connector someone@gmail.com");
      return { path: `/api/emails/${encodeURIComponent(target.toLowerCase())}/connector`, method: "GET" };
    case "import":
      if (!target) throw new MailboxUsageError("Address required.", "domani mailbox import someone@gmail.com --since 2026-06-01");
      if (!options.since) throw new MailboxUsageError("--since is required.", "The date the import should reach back to, for example --since 2026-06-01.");
      return { path: `/api/emails/${encodeURIComponent(target.toLowerCase())}/import`, method: "POST", body: { since: options.since } };
    case "verify":
      if (!target) throw new MailboxUsageError("Address required.", "domani mailbox verify someone@gmail.com");
      return { path: `/api/emails/${encodeURIComponent(target.toLowerCase())}/connector/verify`, method: "POST" };
    case "disconnect":
      if (!target) throw new MailboxUsageError("Address required.", "domani mailbox disconnect someone@gmail.com");
      return { path: `/api/emails/${encodeURIComponent(target.toLowerCase())}/connector`, method: "DELETE" };
    default:
      throw new MailboxUsageError(`Unknown action "${action ?? ""}".`, `Actions: ${MAILBOX_ACTIONS.join(", ")}.`);
  }
}

function printConnector(data: Record<string, unknown>): void {
  heading(`${data.address} (${data.kind})`);
  row("Status", String(data.status));
  row("Phase", String(data.phase) + (data.paused_reason ? ` (${data.paused_reason})` : ""));
  row("Imported since", data.import_since ? new Date(String(data.import_since)).toLocaleString() : "-");
  const forwarding = data.forwarding as { address?: string | null; forwarded?: number; last_forwarded_at?: string | null; confirmation?: { code: string; url: string | null } | null; probe?: { sent_at: string; returned_at: string | null } | null } | undefined;
  if (forwarding) {
    row("Forward to", String(forwarding.address ?? "-"));
    row("Forwarded", `${forwarding.forwarded ?? 0}${forwarding.last_forwarded_at ? `, last ${new Date(forwarding.last_forwarded_at).toLocaleString()}` : ""}`);
    if (forwarding.confirmation) row("Gmail confirmation", `${pc.bold(forwarding.confirmation.code)}${forwarding.confirmation.url ? `  ${forwarding.confirmation.url}` : ""}`);
    if (forwarding.probe) row("Probe", forwarding.probe.returned_at ? `came back ${new Date(forwarding.probe.returned_at).toLocaleString()}` : `sent ${new Date(forwarding.probe.sent_at).toLocaleString()}, not back yet`);
  }
  const run = data.import_run as Record<string, unknown> | null;
  if (run) {
    row("Import", `${run.status}: ${run.copied} copied, ${run.analysed}/${run.to_analyse} analysed${run.listing_done ? "" : ", still listing"}`);
  }
  if (data.source_messages_total) row("In the source", `${data.source_messages_total} messages`);
  row("Last sync", data.last_sync_at ? new Date(String(data.last_sync_at)).toLocaleString() : "never");
  if (data.last_error) row("Last error", pc.yellow(String(data.last_error)));
}

export async function mailbox(action: string | undefined, target: string | undefined, options: MailboxOptions): Promise<void> {
  let request: ReturnType<typeof buildMailboxRequest>;
  try {
    request = buildMailboxRequest(action, target, options);
  } catch (error) {
    if (error instanceof MailboxUsageError) return fail(error.message, { hint: error.hint, code: "validation_error", json: options.json });
    throw error;
  }
  const response = await apiRequest(request.path, { method: request.method, ...(request.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) } : {}) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string; message?: string; hint?: string };
  if (!response.ok) return fail(data.error || data.message || "Request failed", { hint: data.hint, status: response.status, json: options.json, code: String(data.code ?? "request_failed") });
  if (action === "connect" && target === "forwarding") {
    if (options.json) return jsonOut(data, options.fields);
    heading("Connect your inbox by forwarding");
    row("Inbox", String(data.address));
    row("Forward to", pc.cyan(String(data.forwarding_address)));
    row("Status", String(data.status));
    const instructions = data.instructions as Record<string, string[]> | undefined;
    for (const [provider, steps] of Object.entries(instructions ?? {})) {
      console.log(`\n  ${pc.bold(provider === "gmail" ? "Gmail" : provider === "outlook" ? "Outlook" : "Any provider")}`);
      steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
    }
    hint(`Then: domani mailbox verify ${data.address} sends a probe; domani mailbox connector ${data.address} shows the confirmation code and the status.`);
    return;
  }
  if (action === "connect") {
    if (options.json && !options.wait) return jsonOut(data, options.fields);
    heading("Connect your Gmail inbox");
    row("Import since", new Date(String(data.import_since)).toLocaleString());
    console.log(`\n  Open this link in your browser and choose the Google account:\n  ${pc.cyan(String(data.auth_url))}\n`);
    if (options.open !== false) openUrl(String(data.auth_url));
    hint("After consent, the inbox appears as a connected mailbox at its own address; check it with: domani mailbox connector <address>");
    if (options.wait) {
      // Poll the mailbox list for a connected mailbox created after now.
      const startedAt = Date.now();
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await sleep(5000);
        const list = await apiRequest("/api/emails?limit=50");
        const listed = await list.json().catch(() => ({})) as { mailboxes?: Array<{ email?: string; address?: string; kind?: string; created_at?: string }> };
        const found = (listed.mailboxes ?? []).find((box) => box.kind === "connected" && box.created_at && Date.parse(box.created_at) >= startedAt - 60_000);
        if (found) {
          const address = found.address ?? found.email;
          if (options.json) return jsonOut({ status: "connected", address }, options.fields);
          console.log(`\n  ${pc.green("Connected")} ${address}`);
          return;
        }
      }
      return fail("No inbox was connected within 15 minutes.", { code: "connect_timeout", json: options.json });
    }
    return;
  }
  if (options.json) return jsonOut(data, options.fields);
  if (action === "connector") return printConnector(data);
  if (action === "verify") {
    heading("Probe sent");
    row("To", String(data.sent_to));
    row("Comes back through", String(data.forwarding_address));
    hint("When the rule brings it back, the connection is active: domani mailbox connector <address>");
    return;
  }
  if (action === "import") {
    heading("Importing older mail");
    row("From", new Date(String(data.import_since)).toLocaleString());
    row("To", new Date(String(data.import_until)).toLocaleString());
    hint(`Progress: domani mailbox connector ${target}`);
    return;
  }
  if (action === "disconnect") {
    heading("Disconnected");
    row("Address", String(data.address));
    row("Removed", `${data.removed_messages} messages, ${data.removed_attachments} attachments`);
  }
}
