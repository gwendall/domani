import pc from "picocolors";
import { writeFileSync } from "node:fs";
import { apiRequest } from "../api.js";
import { persistentIdempotencyKey } from "../idempotency.js";
import { blank, createSpinner, fail, heading, jsonOut, row, S, table } from "../ui.js";

export const ASSISTANT_CONSENT_VERSION = "mailzero-personal-ai.v1";

export type AssistantOptions = {
  correspondent?: string;
  mailbox?: string;
  json?: boolean; fields?: string;
  enable?: boolean; disable?: boolean; shadow?: boolean; pause?: boolean; resume?: boolean;
  mailboxes?: string; none?: boolean; days?: string; attachmentVision?: string;
  consent?: boolean;
  option?: string; decision?: string; decisionVersion?: string; itemVersion?: string; scope?: string;
  text?: string; until?: string; field?: string;
  limit?: string; out?: string; yes?: boolean; idempotencyKey?: string;
};

export type AssistantRequest = {
  method: "GET" | "PUT" | "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  /** Stable operation label; when set, a persisted idempotency key is attached. */
  idempotency?: string;
};

export class AssistantUsageError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "AssistantUsageError";
  }
}

const INTERACTIONS: Record<string, "choose" | "instruct" | "take_over" | "snooze" | "ignore" | "correct"> = {
  choose: "choose",
  instruct: "instruct",
  "take-over": "take_over",
  snooze: "snooze",
  ignore: "ignore",
  correct: "correct",
};

export const ASSISTANT_ACTIONS = [
  "today", "settings", "set", "preview", "backfill", "retry", "item",
  "choose", "instruct", "snooze", "ignore", "take-over", "correct",
  "plan", "activity", "export", "delete", "brief", "facts",
] as const;

function parseMailboxes(value: string | undefined): string[] {
  return (value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function parseInteger(value: string | undefined, label: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) throw new AssistantUsageError(`${label} must be an integer of at least ${min}`);
  return parsed;
}

/** Pure request planner: no network, no exit. Throws AssistantUsageError on bad input. */
export function buildAssistantRequest(action: string | undefined, id: string | undefined, options: AssistantOptions): AssistantRequest {
  const resolved = action || "today";
  switch (resolved) {
    case "today":
      return { method: "GET", path: "/api/assistant/today" };
    case "settings":
      return { method: "GET", path: "/api/assistant/settings" };
    case "set": {
      const body: Record<string, unknown> = {};
      if (options.enable && options.disable) throw new AssistantUsageError("Use either --enable or --disable");
      if (options.pause && options.resume) throw new AssistantUsageError("Use either --pause or --resume");
      if (options.enable) body.enabled = true;
      if (options.disable) body.enabled = false;
      if (options.shadow !== undefined) body.shadow_enabled = options.shadow;
      if (options.pause) body.paused = true;
      if (options.resume) body.paused = false;
      if (options.none) body.mailbox_ids = [];
      else if (options.mailboxes !== undefined) body.mailbox_ids = parseMailboxes(options.mailboxes);
      if (options.days !== undefined) body.history_window_days = parseInteger(options.days, "--days", 1);
      if (options.attachmentVision !== undefined) {
        if (!["on", "off"].includes(options.attachmentVision)) throw new AssistantUsageError("--attachment-vision must be on or off");
        body.attachment_vision = options.attachmentVision === "on";
      }
      if (!Object.keys(body).length) {
        throw new AssistantUsageError("Provide at least one setting", "Options: --enable, --disable, --shadow, --no-shadow, --pause, --resume, --mailboxes <ids>, --none, --days <n>, --attachment-vision <on|off>");
      }
      return { method: "PUT", path: "/api/assistant/settings", body };
    }
    case "preview": {
      if (!options.consent) {
        throw new AssistantUsageError(
          "--consent is required to start the assistant",
          `Consent means Domani may read the selected mailboxes and send bounded, minimized message content to the approved private model route (version ${ASSISTANT_CONSENT_VERSION}). Nothing is ever sent on your behalf. You can pause or delete derived data at any time.`,
        );
      }
      const mailboxIds = parseMailboxes(options.mailboxes);
      if (!mailboxIds.length) throw new AssistantUsageError("--mailboxes is required", "Pass owned mailbox IDs, comma-separated. List them with: domani assistant settings");
      return {
        method: "POST",
        path: "/api/assistant/preview",
        body: {
          mailbox_ids: mailboxIds,
          history_window_days: options.days === undefined ? 30 : parseInteger(options.days, "--days", 1),
          consent: true,
          consent_version: ASSISTANT_CONSENT_VERSION,
        },
      };
    }
    case "backfill":
      return { method: "GET", path: "/api/assistant/backfill" };
    case "retry":
      return { method: "POST", path: "/api/assistant/backfill", idempotency: "assistant:retry" };
    case "item":
      if (!id) throw new AssistantUsageError("Work item ID is required", "Usage: domani assistant item <id>");
      return { method: "GET", path: `/api/assistant/work-items/${encodeURIComponent(id)}` };
    case "brief": {
      if (id) return { method: "GET", path: `/api/assistant/work-items/${encodeURIComponent(id)}/brief` };
      if (!options.correspondent) throw new AssistantUsageError("Work item ID or --correspondent is required", "Usage: domani assistant brief <id> | domani assistant brief --correspondent ada@example.com [--mailbox hi@myapp.dev]");
      const params = new URLSearchParams({ correspondent: options.correspondent });
      if (options.mailbox) params.set("mailbox", options.mailbox);
      return { method: "GET", path: `/api/assistant/brief?${params}` };
    }
    case "facts":
      if (!id) throw new AssistantUsageError("Work item ID is required", "Usage: domani assistant facts <id>");
      return { method: "GET", path: `/api/assistant/work-items/${encodeURIComponent(id)}/facts` };
    case "plan":
      if (!id) throw new AssistantUsageError("Action plan ID is required", "Usage: domani assistant plan <id>");
      return { method: "GET", path: `/api/assistant/action-plans/${encodeURIComponent(id)}` };
    case "activity": {
      const query = options.limit !== undefined ? `?limit=${parseInteger(options.limit, "--limit", 1)}` : "";
      return { method: "GET", path: `/api/assistant/activity${query}` };
    }
    case "export":
      return { method: "GET", path: "/api/assistant/data" };
    case "delete":
      if (!options.yes) throw new AssistantUsageError("Deleting derived assistant data requires --yes", "This removes analyses, Decisions, plans, receipts, imports, and settings. Source mail is never touched.");
      return { method: "DELETE", path: "/api/assistant/data" };
    case "choose":
    case "instruct":
    case "snooze":
    case "ignore":
    case "take-over":
    case "correct": {
      if (!id) throw new AssistantUsageError("Work item ID is required", `Usage: domani assistant ${resolved} <id> --item-version <work_item_version>`);
      if (options.itemVersion === undefined) throw new AssistantUsageError("--item-version is required", "Pass the work_item_version shown by: domani assistant item <id>");
      const type = INTERACTIONS[resolved];
      const body: Record<string, unknown> = { type, work_item_version: parseInteger(options.itemVersion, "--item-version", 1) };
      if (type === "ignore" && options.scope) {
        if (!["item", "sender", "sender_domain", "situation"].includes(options.scope)) throw new AssistantUsageError("--scope must be item, sender, sender_domain or situation", "Example: domani assistant ignore <id> --item-version 3 --scope sender");
        body.scope = options.scope;
      }
      if (type === "choose") {
        if (!options.option || !options.decision || options.decisionVersion === undefined) {
          throw new AssistantUsageError("--option, --decision and --decision-version are required", "They come from the Decision shown by: domani assistant item <id>");
        }
        body.decision_id = options.decision;
        body.decision_version = parseInteger(options.decisionVersion, "--decision-version", 1);
        body.option_id = options.option;
      }
      if (type === "instruct") {
        if (!options.text) throw new AssistantUsageError("--text is required", "The instruction the assistant should follow when preparing the draft");
        body.instruction = options.text;
      }
      if (type === "snooze") {
        if (!options.until) throw new AssistantUsageError("--until is required", "ISO 8601 date-time, for example 2026-09-03T09:00:00Z");
        body.until = options.until;
      }
      if (type === "correct") {
        if (!options.field || !options.text) throw new AssistantUsageError("--field and --text are required", "Name the analysis field to correct and the correct value");
        body.field = options.field;
        body.correction = options.text;
      }
      return { method: "POST", path: `/api/assistant/work-items/${encodeURIComponent(id)}/interactions`, body, idempotency: `assistant:${type}:${id}` };
    }
    default:
      throw new AssistantUsageError(`Unknown action: ${resolved}`, `Actions: ${ASSISTANT_ACTIONS.join(", ")}`);
  }
}

async function responseOrFail(res: Response, options: AssistantOptions) {
  const data = await res.json();
  if (res.ok) return data;
  if (data.code === "NOT_AVAILABLE") {
    fail("The Mailzero assistant is in private preview", { hint: "It is enabled per account during the private beta. Ask for access at https://domani.run/support or wait for general availability.", code: "not_available", status: res.status, json: options.json, fields: options.fields });
  }
  if (data.code === "INSUFFICIENT_SCOPE") {
    fail(data.error || "Missing assistant scope", { hint: "This token needs the assistant:read scope for reads and assistant:write for changes. Create one with: domani tokens create --scopes assistant:read,assistant:write", code: "insufficient_scope", status: res.status, json: options.json, fields: options.fields });
  }
  fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
}

type WorkItem = {
  id: string;
  version?: number;
  status?: string;
  title?: string;
  summary?: string;
  mailbox?: { id?: string; address?: string; name?: string | null };
  source?: { type?: string; conversation_id?: string | null; event_id?: string; revision?: number };
  attention?: { level?: string; reason?: string; confidence?: string; deadline?: string | null };
  ask?: string | null;
  sender?: { address?: string; name?: string | null; kind?: string } | null;
  recurrence?: { count?: number; first_seen_at?: string | null; last_seen_at?: string | null };
  decision?: { id?: string; version?: number; status?: string; question?: string; options?: Array<{ id: string; label: string; recommended?: boolean; outcome?: string }> } | null;
  plan?: { id?: string; status?: string; expires_at?: string } | null;
};

function itemLine(item: WorkItem): string[] {
  const who = item.sender?.name || item.sender?.address?.split("@")[0] || item.mailbox?.name || item.mailbox?.address || "";
  const count = item.recurrence?.count && item.recurrence.count > 1 ? pc.dim(`x${item.recurrence.count}`) : "";
  return [pc.dim(item.id), who, `${(item.title || item.summary || "").slice(0, 60)} ${count}`.trim(), item.ask ? item.ask.slice(0, 50) : item.attention?.deadline || ""];
}

function showToday(data: Record<string, WorkItem[] | unknown>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  blank(); heading("Today");
  const sections: Array<[string, string]> = [["now", "Now"], ["needs_you", "Needs you"], ["waiting", "Waiting"], ["upcoming", "Upcoming"], ["handled", "Handled"]];
  let shown = 0;
  for (const [key, label] of sections) {
    const source = (data.sections && typeof data.sections === "object" ? data.sections : data) as Record<string, unknown>;
    const items = Array.isArray(source[key]) ? (source[key] as WorkItem[]) : [];
    if (!items.length) continue;
    shown += items.length;
    console.log(`  ${pc.bold(label)} ${pc.dim(`(${items.length})`)}`);
    table(["ID", "Who", "Summary", "Deadline"], items.map(itemLine));
    blank();
  }
  if (!shown) console.log(pc.dim("  Nothing needs you right now."));
  const asOf = typeof data.as_of === "string" ? data.as_of : undefined;
  if (asOf) console.log(pc.dim(`  As of ${asOf}`));
  blank();
}

interface Brief {
  title?: string; summary?: string; ask?: string | null;
  situation?: { status?: string; attention?: { level?: string; reason?: string }; occurrences?: number; sender?: { address?: string; name?: string | null } | null };
  story?: Array<{ occurred_at: string; sender: string; title: string; analysed: boolean }>;
  facts?: Array<{ subject: string | null; predicate: string | null; value: { value: string | null; currency: string | null } | null; object: string | null }>;
  awaiting?: Array<{ who: string; what: string; since: string; overdue: boolean }>;
  commitments?: Array<{ who: string; what: string; overdue: boolean }>;
  settled?: Array<{ kind: string; who: string; what: string; status: string; at: string }>;
  suggested_next?: { action: string; reason: string; source: string } | null;
  decision?: { question?: string; options?: Array<{ id: string; label: string; recommended: boolean }> } | null;
}

function showBrief(data: Record<string, unknown>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  const brief = ((data.brief as Brief | null | undefined) ?? (data as Brief));
  if (data.correspondent && !data.brief) {
    blank(); heading(`Brief for ${data.correspondent}`);
    console.log(`  ${pc.dim("Nothing analysed from this person yet.")}`);
    for (const mail of (data.recent_mail as Array<{ subject: string | null; received_at: string; mailbox: string }>) || []) row(mail.received_at.slice(0, 10), `${mail.subject || ""} (${mail.mailbox})`);
    return;
  }
  blank(); heading(brief.title || "Brief");
  if (brief.situation) row("Status", `${brief.situation.status || ""}${brief.situation.attention?.level ? ` · ${brief.situation.attention.level}` : ""}${brief.situation.occurrences && brief.situation.occurrences > 1 ? ` · ${brief.situation.occurrences} messages` : ""}`);
  if (brief.situation?.sender?.address) row("With", `${brief.situation.sender.name ? `${brief.situation.sender.name} ` : ""}<${brief.situation.sender.address}>`);
  if (brief.summary) row("Summary", brief.summary);
  if (brief.ask) row("Ask", brief.ask);
  for (const line of brief.story || []) row(line.occurred_at.slice(0, 10), `${line.title}${line.analysed ? "" : pc.dim(" (not analysed)")}`);
  for (const fact of brief.facts || []) row("Fact", `${fact.subject || ""} ${fact.predicate || ""} ${fact.value?.value ?? fact.object ?? ""}${fact.value?.currency ? ` ${fact.value.currency}` : ""}`.trim());
  for (const loop of brief.awaiting || []) row(loop.overdue ? pc.red("Awaited") : "Awaited", `${loop.who}: ${loop.what} (since ${loop.since.slice(0, 10)})`);
  for (const loop of brief.commitments || []) row(loop.overdue ? pc.red("Promised") : "Promised", `${loop.who}: ${loop.what}`);
  for (const entry of (brief.settled || []).slice(0, 5)) row("Settled", `${entry.what} (${entry.status}, ${entry.at.slice(0, 10)})`);
  if (brief.decision?.question) row("Decision", `${brief.decision.question} ${(brief.decision.options || []).map((option) => `${option.recommended ? "★ " : ""}${option.label}`).join(" / ")}`);
  if (brief.suggested_next) row("Next", `${brief.suggested_next.action} ${pc.dim(`(${brief.suggested_next.reason})`)}`);
  if (data.related && (data.related as unknown[]).length) row("Also", `${(data.related as unknown[]).length} other item(s) from this person`);
}

function showItem(data: Record<string, unknown>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  const item = (data.work_item || data) as WorkItem;
  blank(); heading("Work item");
  row("ID", item.id); row("Version", String(item.version ?? "")); row("Status", item.status || "");
  row("Mailbox", item.mailbox?.name ? `${item.mailbox.name} <${item.mailbox.address || ""}>` : item.mailbox?.address || "");
  if (item.title) row("Title", item.title);
  if (item.sender?.address) row("From", `${item.sender.name ? `${item.sender.name} ` : ""}<${item.sender.address}>${item.sender.kind && item.sender.kind !== "human" ? ` (${item.sender.kind})` : ""}`);
  if (item.ask) row("Ask", item.ask);
  if (item.recurrence?.count && item.recurrence.count > 1) row("Recurrence", `${item.recurrence.count} messages since ${(item.recurrence.first_seen_at || "").slice(0, 10)}`);
  row("Summary", item.summary || ""); if (item.attention?.reason) row("Why", item.attention.reason);
  if (item.attention?.deadline) row("Deadline", item.attention.deadline);
  if (item.source?.event_id) row("Source", `${item.source.type || "mail"} ${item.source.event_id}`);
  if (item.decision?.options?.length) {
    blank(); console.log(`  ${pc.bold("Decision")} ${pc.dim(`${item.decision.id} v${item.decision.version ?? 1}`)}`);
    for (const option of item.decision.options) console.log(`    ${pc.dim(option.id)}  ${option.label}${option.recommended ? pc.green("  recommended") : ""}`);
    console.log(pc.dim(`    Choose with: domani assistant choose ${item.id} --version ${item.version ?? 1} --decision ${item.decision.id} --decision-version ${item.decision.version ?? 1} --option <id>`));
  }
  if (item.plan?.id) row("Plan", `${item.plan.id}  (preview with: domani assistant plan ${item.plan.id})`);
  blank();
}

function showSettings(data: Record<string, any>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  blank(); heading("Mailzero assistant");
  row("Enabled", data.enabled ? "yes" : "no"); row("Shadow", data.shadow_enabled ? "yes" : "no"); row("Paused", data.paused ? "yes" : "no");
  row("History window", `${data.history_window_days} days`); row("Privacy route", String(data.privacy_route || ""));
  row("Consent", data.consent?.accepted_version ? `${data.consent.accepted_version} at ${data.consent.accepted_at}` : `none (required: ${data.consent?.required_version || ASSISTANT_CONSENT_VERSION})`);
  blank();
  const enabled = new Set<string>(data.mailbox_ids || []);
  const mailboxes = (data.mailboxes || []) as Array<{ id: string; address: string }>;
  if (mailboxes.length) table(["ID", "Address", "AI"], mailboxes.map((mailbox) => [pc.dim(mailbox.id), mailbox.address, enabled.has(mailbox.id) ? pc.green("on") : pc.dim("off")]));
  blank();
}

function showBackfill(data: Record<string, any>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  const backfill = data.backfill;
  blank(); heading("History import");
  if (!backfill) { console.log(pc.dim("  No import has run yet.")); blank(); return; }
  row("Status", `${backfill.status} (${backfill.phase})`); row("Progress", `${backfill.processed}/${backfill.total}${backfill.percent === null || backfill.percent === undefined ? "" : ` (${backfill.percent}%)`}`);
  row("Failed", String(backfill.failed ?? 0)); row("Paused", backfill.paused ? "yes" : "no");
  if (backfill.estimated_completion_at) row("ETA", backfill.estimated_completion_at);
  if (backfill.can_close_app) console.log(pc.dim("  The import continues in the background."));
  blank();
}

function showPlan(data: Record<string, any>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  const plan = data.action_plan || data.plan || data;
  blank(); heading("Action preview");
  row("ID", plan.id); row("Status", plan.status || ""); if (plan.expires_at) row("Expires", plan.expires_at);
  for (const effect of (plan.effects || []) as Array<Record<string, any>>) {
    blank(); console.log(`  ${pc.bold(effect.kind || "effect")}  ${pc.dim(`mailbox ${effect.mailbox_id || ""}`)}${effect.reply_to_message_id ? pc.dim(`  in reply to ${effect.reply_to_message_id}`) : ""}`);
    if (effect.body) console.log(`\n${String(effect.body).split("\n").map((line) => `    ${line}`).join("\n")}\n`);
  }
  console.log(pc.dim(`  Nothing is sent by this command. Send through the reply endpoint with assistant_plan_id=${plan.id} or from the app.`));
  blank();
}

function showActivity(data: Record<string, any>, options: AssistantOptions): void {
  if (options.json) return jsonOut(data, options.fields);
  const activity = (data.events || []) as Array<Record<string, any>>;
  blank(); heading("Assistant activity");
  if (!activity.length) console.log(pc.dim("  No activity yet."));
  else table(["When", "Kind", "Action", "Work item"], activity.map((entry) => [entry.occurred_at || "", entry.kind || "", entry.action || entry.type || "", pc.dim(entry.work_item?.id || entry.work_item_id || "")]));
  blank();
}

export async function assistant(action: string | undefined, id: string | undefined, options: AssistantOptions): Promise<void> {
  let request: AssistantRequest;
  try {
    request = buildAssistantRequest(action, id, options);
  } catch (error) {
    if (error instanceof AssistantUsageError) fail(error.message, { hint: error.hint, code: "validation_error", json: options.json });
    throw error;
  }
  const resolved = action || "today";
  const headers: Record<string, string> = {};
  let receipt: { key: string; complete: () => void } | undefined;
  if (request.idempotency) {
    receipt = persistentIdempotencyKey(request.idempotency, request.body || {}, options.idempotencyKey);
    headers["Idempotency-Key"] = receipt.key;
    if (request.body && request.path.endsWith("/interactions")) request.body.idempotency_key = receipt.key;
  }
  const spinnerLabel = { set: "Updating assistant settings", preview: "Recording consent and starting the history import", retry: "Requeuing failed messages", delete: "Deleting derived assistant data" }[resolved as "set" | "preview" | "retry" | "delete"] || (request.method !== "GET" ? "Recording your decision" : undefined);
  const spinner = createSpinner(!options.json && !!spinnerLabel);
  if (spinnerLabel) spinner.start(spinnerLabel);
  const res = await apiRequest(request.path, {
    method: request.method,
    headers,
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
  const data = await responseOrFail(res, options);
  receipt?.complete();
  if (spinnerLabel) spinner.stop(`${S.success} Done`);

  switch (resolved) {
    case "today": return showToday(data, options);
    case "settings": return showSettings(data, options);
    case "backfill": return showBackfill(data, options);
    case "item": return showItem(data, options);
    case "brief": return showBrief(data, options);
    case "facts": return jsonOut(data, options.fields);
    case "plan": return showPlan(data, options);
    case "activity": return showActivity(data, options);
    case "export": {
      const json = `${JSON.stringify(data, null, 2)}\n`;
      if (options.out) {
        writeFileSync(options.out, json, "utf8");
        if (options.json) return jsonOut({ exported: true, path: options.out }, options.fields);
        console.log(`${S.success} Derived assistant data exported to ${options.out}`);
        return;
      }
      process.stdout.write(json);
      return;
    }
    case "delete":
      if (options.json) return jsonOut(data, options.fields);
      console.log(`${S.success} Derived assistant data deleted. Source mail is untouched.`);
      return;
    default:
      if (options.json) return jsonOut(data, options.fields);
      if (resolved === "set" || resolved === "preview" || resolved === "retry") {
        if (resolved === "preview") console.log(pc.dim(`  Import ${data.preview?.backfill_id || ""} runs in the background. Follow it with: domani assistant backfill`));
        if (resolved === "retry") console.log(`  Requeued ${data.retried ?? data.requeued ?? 0} messages`);
        if (resolved === "set") console.log(`  enabled=${data.enabled ? "yes" : "no"} shadow=${data.shadow_enabled ? "yes" : "no"} paused=${data.paused ? "yes" : "no"} mailboxes=${(data.mailbox_ids || []).length}`);
        return;
      }
      if (data.work_item) return showItem(data, options);
      return jsonOut(data, options.fields);
  }
}
