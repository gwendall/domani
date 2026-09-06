import { apiRequest } from "../api.js";
import pc from "picocolors";
import { fail, heading, hint, jsonOut, row, table } from "../ui.js";

interface AgentsOptions {
  json?: boolean;
  fields?: string;
  name?: string;
  mailboxes?: string;
  tokenId?: string;
}

export const AGENT_ACTIONS = ["list", "token", "tokens", "revoke-token"] as const;

export class AgentsUsageError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = "AgentsUsageError";
  }
}

/** Pure request planner for `domani agents`: no network, no exit. */
export function buildAgentsRequest(action: string | undefined, slug: string | undefined, options: AgentsOptions): { method: string; path: string; body?: Record<string, unknown> } {
  switch (action || "list") {
    case "list":
      return { method: "GET", path: "/api/agents/identity" };
    case "token": {
      if (!slug) throw new AgentsUsageError("Agent handle is required", 'Usage: domani agents token <slug> [--name "Dave on the pod"] [--mailboxes mb_1,mb_2]');
      const mailboxIds = (options.mailboxes || "").split(",").map((part) => part.trim()).filter(Boolean);
      return { method: "POST", path: `/api/agents/identity/${encodeURIComponent(slug)}/tokens`, body: { ...(options.name ? { name: options.name } : {}), ...(mailboxIds.length ? { mailbox_ids: mailboxIds } : {}) } };
    }
    case "tokens":
      if (!slug) throw new AgentsUsageError("Agent handle is required", "Usage: domani agents tokens <slug>");
      return { method: "GET", path: `/api/agents/identity/${encodeURIComponent(slug)}/tokens` };
    case "revoke-token":
      if (!slug || !options.tokenId) throw new AgentsUsageError("Agent handle and --token-id are required", "Usage: domani agents revoke-token <slug> --token-id <id>");
      return { method: "DELETE", path: `/api/agents/identity/${encodeURIComponent(slug)}/tokens/${encodeURIComponent(options.tokenId)}` };
    default:
      throw new AgentsUsageError(`Unknown action: ${action}`, `Actions: ${AGENT_ACTIONS.join(", ")}`);
  }
}

export async function agents(action: string | undefined, slug: string | undefined, options: AgentsOptions): Promise<void> {
  let request: ReturnType<typeof buildAgentsRequest>;
  try {
    request = buildAgentsRequest(action, slug, options);
  } catch (error) {
    if (error instanceof AgentsUsageError) return fail(error.message, { hint: error.hint, code: "validation_error", json: options.json, fields: options.fields });
    throw error;
  }
  const response = await apiRequest(request.path, { method: request.method, ...(request.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return fail(data.error || data.message || "Request failed", { hint: data.hint, status: response.status, json: options.json, fields: options.fields });
  if (options.json) return jsonOut(data, options.fields);
  switch (action || "list") {
    case "list": {
      const identities = (data.identities || data.items || []) as Array<{ slug: string; name?: string | null; email?: string | null }>;
      heading("Agent identities");
      if (!identities.length) { console.log(`  ${pc.dim("No agent identity yet. Claim one: domani agents claim is on the web at /agents")}`); return; }
      table(["Handle", "Name", "Email"], identities.map((identity) => [identity.slug, identity.name || "", identity.email || ""]), [24, 30, 40]);
      return;
    }
    case "token": {
      heading("Agent API key");
      row("Key", data.key || data.token || "");
      if (data.scopes) row("Scopes", (data.scopes as string[]).join(", "));
      if (data.mailbox_ids?.length) row("Mailboxes", (data.mailbox_ids as string[]).join(", "));
      hint("Shown once. The key sees only this agent's mailboxes and the items handed to it.");
      return;
    }
    case "tokens": {
      const tokens = (data.tokens || []) as Array<{ id: string; name?: string | null; scopes?: string[]; created_at?: string; last_used_at?: string | null }>;
      heading("Agent API keys");
      if (!tokens.length) { console.log(`  ${pc.dim("No key yet: domani agents token <slug>")}`); return; }
      table(["ID", "Name", "Scopes", "Last used"], tokens.map((token) => [token.id, token.name || "", (token.scopes || []).join(","), token.last_used_at || "never"]), [28, 24, 40, 20]);
      return;
    }
    case "revoke-token":
      console.log(`${pc.green("✓")} Token revoked`);
      return;
  }
}
