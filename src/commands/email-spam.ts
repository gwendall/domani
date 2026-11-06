import pc from "picocolors";
import { apiRequest } from "../api.js";
import { S, heading, row, table, hint, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";

/**
 * The spam gesture and the account's learned sender rules: `email spam`,
 * `email not-spam`, `email sender-rules`, `email sender-rule-add` and
 * `email sender-rule-remove`. A rule holds for every mailbox of the account.
 */

export interface SpamCliOptions {
  slug?: string;
  domain?: string;
  messageId?: string;
  messageIds?: string;
  confirm?: boolean;
  action?: string;
  match?: string;
  value?: string;
  keepMoved?: boolean;
  limit?: string;
  cursor?: string;
  json?: boolean;
  fields?: string;
}

interface SenderRule {
  id: string;
  action: "block" | "allow";
  match: "address" | "domain" | "campaign";
  value: string;
  label: string | null;
  source: string;
  created_by: { type: string; label: string };
  created_at: string;
  moved: number;
  hits: number;
}

interface Suggestion {
  action: "block";
  match: "domain" | "campaign";
  value: string;
  label: string | null;
  count: number;
  mailboxes: number;
}

const RULE_ACTIONS = ["block", "allow"];
const RULE_MATCHES = ["address", "domain", "campaign"];

function failUsage(message: string, usage: string, options: SpamCliOptions): never {
  return fail(message, { hint: usage, code: "validation_error", json: options.json, fields: options.fields });
}

function mailboxAddress(options: SpamCliOptions): string | null {
  return options.slug && options.domain ? `${options.slug}@${options.domain}` : null;
}

/** The message a gesture is made on: the positional argument, else --message-id. */
export function gestureMessageId(arg2: string | undefined, options: Pick<SpamCliOptions, "messageId" | "messageIds">): string | undefined {
  return options.messageId || options.messageIds || (arg2 && !arg2.includes("@") ? arg2 : undefined);
}

export function gesturePath(address: string, messageId: string, verdict: "spam" | "not-spam"): string {
  return `/api/emails/${encodeURIComponent(address)}/messages/${encodeURIComponent(messageId)}/${verdict}`;
}

/** The command that applies a suggestion the spam gesture returned. */
export function suggestionCommand(suggestion: Pick<Suggestion, "match" | "value">, address: string, messageId: string): string {
  return suggestion.match === "domain"
    ? `domani email sender-rule-add --action block --match domain --value ${suggestion.value}`
    : `domani email sender-rule-add --action block --match campaign --from ${address} --message-id ${messageId}`;
}

export function senderRulesQuery(options: Pick<SpamCliOptions, "action" | "limit" | "cursor">): string {
  const params = new URLSearchParams();
  if (options.action) params.set("action", options.action);
  if (options.limit) params.set("limit", options.limit);
  if (options.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** The POST /api/sender-rules body: a value, or the message (mailbox + id) the rule is taken from. */
export function senderRuleBody(options: SpamCliOptions): { body: Record<string, unknown> } | { error: string } {
  if (!options.action || !RULE_ACTIONS.includes(options.action)) return { error: "--action must be block or allow" };
  if (!options.match || !RULE_MATCHES.includes(options.match)) return { error: "--match must be address, domain or campaign" };
  const address = mailboxAddress(options);
  const body: Record<string, unknown> = { action: options.action, match: options.match };
  if (options.messageId) {
    if (!address) return { error: "--message-id needs --from, the mailbox the message is in" };
    body.mailbox = address;
    body.message_id = options.messageId;
  } else if (options.value) {
    if (options.match === "campaign") return { error: "A campaign rule is taken from a message: pass --from and --message-id" };
    body.value = options.value;
  } else {
    return { error: "Pass --value, or --from and --message-id" };
  }
  if (options.confirm) body.confirm = true;
  return { body };
}

export function removeRulePath(id: string, keepMoved?: boolean): string {
  return `/api/sender-rules/${encodeURIComponent(id)}${keepMoved ? "?restore=false" : ""}`;
}

export function ruleDescription(rule: Pick<SenderRule, "match" | "value" | "label">): string {
  if (rule.match === "campaign") return rule.label ? `campaign "${rule.label.slice(0, 48)}"` : `campaign ${rule.value.slice(0, 8)}`;
  return rule.match === "domain" ? `everything from ${rule.value}` : rule.value;
}

async function send(path: string, init: RequestInit, options: SpamCliOptions, label: string): Promise<Record<string, any>> {
  const s = createSpinner(!options.json);
  s.start(label);
  const res = await apiRequest(path, init);
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }
  s.stop("Done");
  return data;
}

export async function spamCli(arg2: string | undefined, options: SpamCliOptions): Promise<void> {
  const usage = "Usage: domani email spam <message_id> --from hi@myapp.dev [--confirm]";
  const address = mailboxAddress(options);
  const messageId = gestureMessageId(arg2, options);
  if (!address || !messageId) failUsage("Mailbox and message ID required", usage, options);
  const data = await send(gesturePath(address!, messageId!, "spam"), { method: "POST", body: JSON.stringify(options.confirm ? { confirm: true } : {}) }, options, "Marking as spam");
  if (options.json) return jsonOut(data, options.fields);
  heading("Spam");
  row("Message", `${data.message_id} ${pc.dim("moved to Spam")}`);
  if (data.rule) row("Blocked", `${pc.cyan(data.sender)} ${pc.dim("for every mailbox of the account")}`);
  row("Moved", `${data.moved} other message${data.moved === 1 ? "" : "s"} from the sender`);
  if (data.confirmation_required) {
    console.log(`  ${S.warning} ${data.confirmation_required.message}`);
    hintCommand("Block them anyway:", `domani email spam ${messageId} --from ${address} --confirm`);
  }
  const suggestions = (data.suggestions || []) as Suggestion[];
  if (suggestions.length) {
    console.log();
    console.log(`  ${pc.bold("One step further")}`);
    for (const suggestion of suggestions) {
      const what = suggestion.match === "domain" ? `Everything from ${suggestion.value}` : `The same campaign${suggestion.label ? ` ("${suggestion.label.slice(0, 48)}")` : ""}`;
      console.log(`  ${what}: ${suggestion.count} message${suggestion.count === 1 ? "" : "s"} in ${suggestion.mailboxes} mailbox${suggestion.mailboxes === 1 ? "" : "es"}`);
      hintCommand("  Apply:", suggestionCommand(suggestion, address!, messageId!));
    }
  } else if (data.hint) {
    hint(data.hint);
  }
}

export async function notSpamCli(arg2: string | undefined, options: SpamCliOptions): Promise<void> {
  const usage = "Usage: domani email not-spam <message_id> --from hi@myapp.dev";
  const address = mailboxAddress(options);
  const messageId = gestureMessageId(arg2, options);
  if (!address || !messageId) failUsage("Mailbox and message ID required", usage, options);
  const data = await send(gesturePath(address!, messageId!, "not-spam"), { method: "POST", body: "{}" }, options, "Marking as not spam");
  if (options.json) return jsonOut(data, options.fields);
  heading("Not spam");
  row("Message", `${data.message_id} ${pc.dim("back in the Inbox")}`);
  if (data.rule) row("Allowed", `${pc.cyan(data.sender)} ${pc.dim("for every mailbox of the account")}`);
  row("Moved", `${data.moved} other message${data.moved === 1 ? "" : "s"} back from Spam`);
  const matching = (data.matching_rules || []) as SenderRule[];
  if (matching.length) {
    console.log();
    console.log(`  ${pc.bold("Wider rules that also matched it")}`);
    for (const rule of matching) {
      console.log(`  Block on ${ruleDescription(rule)}`);
      hintCommand("  Remove:", `domani email sender-rule-remove ${rule.id}`);
    }
  } else if (data.hint) {
    hint(data.hint);
  }
}

export async function senderRulesCli(options: SpamCliOptions): Promise<void> {
  if (options.action && !RULE_ACTIONS.includes(options.action)) failUsage("--action must be block or allow", "Usage: domani email sender-rules [--action block|allow] [--limit 50] [--cursor C]", options);
  const res = await apiRequest(`/api/sender-rules${senderRulesQuery(options)}`);
  const data = await res.json();
  if (!res.ok) fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  const rules = (data.rules || []) as SenderRule[];
  if (!rules.length) {
    console.log(pc.dim("No learned rules yet. Mark a message as spam (domani email spam) to block its sender."));
    return;
  }
  heading("Learned sender rules");
  table(["ID", "Rule", "Moved", "By", "When"], rules.map((rule) => [
    rule.id,
    `${rule.action === "block" ? pc.red("block") : pc.green("allow")} ${ruleDescription(rule)}`,
    String(rule.moved + rule.hits),
    rule.created_by.label.slice(0, 20),
    rule.created_at.slice(0, 10),
  ]), [27, 56, 7, 22, 11]);
  if (data.next_cursor) console.log(pc.dim(`More: --cursor ${data.next_cursor}`));
}

export async function senderRuleAddCli(options: SpamCliOptions): Promise<void> {
  const usage = "Usage: domani email sender-rule-add --action block|allow --match address|domain --value secure.net [--confirm]  (or --match campaign --from hi@myapp.dev --message-id MSG)";
  const built = senderRuleBody(options);
  if ("error" in built) return failUsage(built.error, usage, options);
  const data = await send("/api/sender-rules", { method: "POST", body: JSON.stringify(built.body) }, options, "Saving the rule");
  if (options.json) return jsonOut(data, options.fields);
  const rule = data.rule as SenderRule;
  console.log(`${S.success} ${rule.action === "block" ? "Blocked" : "Allowed"} ${pc.cyan(ruleDescription(rule))} ${pc.dim(`(${rule.id})`)}`);
  console.log(`  ${data.moved} message${data.moved === 1 ? "" : "s"} already received moved ${rule.action === "block" ? "to Spam" : "back to the Inbox"}.`);
  if (data.truncated) hint("The scan stopped early: some older copies of the campaign may still be in place.");
  hintCommand("Undo:", `domani email sender-rule-remove ${rule.id}`);
}

export async function senderRuleRemoveCli(arg2: string | undefined, options: SpamCliOptions): Promise<void> {
  const id = arg2 && !arg2.includes("@") ? arg2 : undefined;
  if (!id) failUsage("Rule ID required", "Usage: domani email sender-rule-remove <rule_id> [--keep-moved]", options);
  const data = await send(removeRulePath(id!, options.keepMoved), { method: "DELETE" }, options, "Removing the rule");
  if (options.json) return jsonOut(data, options.fields);
  console.log(`${S.success} Rule ${pc.cyan(id!)} removed.${options.keepMoved ? "" : ` ${data.restored} message${data.restored === 1 ? "" : "s"} went back where ${data.restored === 1 ? "it was" : "they were"}.`}`);
}
