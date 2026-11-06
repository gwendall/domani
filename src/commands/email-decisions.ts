import pc from "picocolors";
import { apiRequest } from "../api.js";
import { heading, row, table, hint, createSpinner, jsonOut, fail } from "../ui.js";
import { gestureMessageId, type SpamCliOptions } from "./email-spam.js";

/**
 * `domani email decisions <message_id> --from hi@myapp.dev`: why a received
 * message is in its folder and has its kind, decision by decision (GET
 * /api/emails/{address}/messages/{id}/decisions). Read-only; the subject of
 * authentication mail comes back redacted.
 */

export interface Decision {
  at: string;
  axis: string;
  actor: string;
  action: string;
  value: string;
  previous: string | null;
  applied: boolean;
  version: string | null;
  commit: string | null;
  reasons: Array<{ code: string; text: string }>;
}

interface Authentication {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  authserv_id: string | null;
  trusted: boolean;
}

export function decisionsPath(address: string, messageId: string): string {
  return `/api/emails/${encodeURIComponent(address)}/messages/${encodeURIComponent(messageId)}/decisions`;
}

/** One decision as a table row: when, what, who, what it did, the change, why. */
export function decisionRow(decision: Decision): string[] {
  const change = decision.previous && decision.previous !== decision.value ? `${decision.previous} -> ${decision.value}` : decision.value;
  const did = decision.applied ? decision.action : pc.dim(decision.action);
  const why = decision.reasons.map((reason) => reason.code).join(", ");
  return [decision.at.slice(5, 19).replace("T", " "), decision.axis, decision.actor, did, change, why];
}

export function authenticationLine(auth: Authentication | null): string {
  if (!auth) return pc.dim("no verdict");
  const results = `spf ${auth.spf ?? "-"}, dkim ${auth.dkim ?? "-"}, dmarc ${auth.dmarc ?? "-"}`;
  return `${results} ${pc.dim(`(${auth.authserv_id ?? "unknown server"}, ${auth.trusted ? "trusted" : "not trusted"})`)}`;
}

export async function decisionsCli(arg2: string | undefined, options: SpamCliOptions): Promise<void> {
  const usage = "Usage: domani email decisions <message_id> --from hi@myapp.dev";
  const address = options.slug && options.domain ? `${options.slug}@${options.domain}` : null;
  const messageId = gestureMessageId(arg2, options);
  if (!address || !messageId) fail("Mailbox and message ID required", { hint: usage, code: "validation_error", json: options.json, fields: options.fields });
  const s = createSpinner(!options.json);
  s.start("Reading the decisions");
  const res = await apiRequest(decisionsPath(address!, messageId!));
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }
  s.stop("Done");
  if (options.json) return jsonOut(data, options.fields);

  heading("Decisions");
  row("Message", `${data.message_id} ${pc.dim(`(${data.mailbox})`)}`);
  row("From", data.from);
  if (data.subject) row("Subject", data.subject.slice(0, 72));
  row("Now", `${data.current.folder}${data.current.kind ? `, kind ${data.current.kind} ${pc.dim(`(${data.current.kind_decided_by})`)}` : ""}`);
  if (data.direction === "in") row("Authentication", authenticationLine(data.authentication));
  const headers = Object.entries((data.upstream?.headers ?? {}) as Record<string, string>);
  for (const [name, value] of headers) row(name, value.slice(0, 72));
  const decisions = (data.decisions || []) as Decision[];
  if (decisions.length) {
    console.log();
    table(["When (UTC)", "Axis", "Who", "Did", "Value", "Why"], decisions.map(decisionRow), [16, 11, 16, 9, 18, 34]);
  }
  if (data.ledger) {
    const ledger = data.ledger;
    row("Ledger", `${ledger.at.slice(0, 16).replace("T", " ")} ${ledger.status}: ${ledger.verdict.placement ?? "-"} by ${ledger.verdict.layer ?? "-"} ${pc.dim(`(${ledger.version}, ${ledger.model})`)}`);
  }
  hint(data.hint);
}
