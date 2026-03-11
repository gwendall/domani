import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, heading, row, blank, table, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";

export async function tokens(
  action: string | undefined,
  options: {
    json?: boolean;
    fields?: string;
    name?: string;
    scopes?: string;
    expiresIn?: string;
    tokenId?: string;
  },
): Promise<void> {
  switch (action) {
    case undefined:
    case "list":
      return listTokens(options.json, options.fields);
    case "create":
      return createToken(options);
    case "revoke":
      return revokeToken(options);
    default:
      fail(`Unknown action: ${action}`, { hint: "Actions: list, create, revoke", code: "validation_error", json: options.json, fields: options.fields });
  }
}

// ── List ──────────────────────────────────────────────

async function listTokens(json?: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start("Loading tokens");

  const res = await apiRequest("/api/tokens");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop(`${S.success} ${data.tokens.length} token(s)`);

  if (json) {
    jsonOut(data, fields);
    return;
  }

  if (data.tokens.length === 0) {
    blank();
    console.log(`  ${pc.dim("No tokens.")}`);
    blank();
    hintCommand("Create one:", "domani tokens create --name \"My App\"");
    blank();
    return;
  }

  blank();
  heading("API Tokens");
  const rows = data.tokens.map((t: { id: string; name: string; key: string; scopes: string[]; expiresAt: string | null; expired: boolean; lastUsed: string | null; createdAt: string }) => {
    let expiry: string;
    if (t.expired) {
      expiry = pc.red("Expired");
    } else if (t.expiresAt) {
      expiry = pc.dim(`Expires ${new Date(t.expiresAt).toLocaleDateString()}`);
    } else {
      expiry = pc.dim("No expiration");
    }

    const scopeStr = t.scopes.includes("*") ? pc.dim("all") : pc.dim(t.scopes.join(", "));

    return [
      pc.dim(t.id),
      pc.bold(t.name),
      scopeStr,
      expiry,
    ];
  });
  table(["ID", "Name", "Scopes", "Expiration"], rows, [28, 16, 32, 20]);
  blank();
}

// ── Create ────────────────────────────────────────────

async function createToken(options: { json?: boolean; fields?: string; name?: string; scopes?: string; expiresIn?: string }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (options.name) body.name = options.name;
  if (options.scopes) {
    body.scopes = options.scopes.split(",").map((s) => s.trim());
  }
  if (options.expiresIn) {
    const seconds = Number(options.expiresIn);
    if (isNaN(seconds) || seconds < 3600 || seconds > 31536000) {
      fail("Invalid --expires-in value", { hint: "Must be between 3600 (1 hour) and 31536000 (1 year) seconds", code: "validation_error", json: options.json, fields: options.fields });
    }
    body.expires_in = seconds;
  }

  const s = createSpinner(!options.json);
  s.start("Creating token");

  const res = await apiRequest("/api/tokens", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Token created`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  heading("Token Created");
  row("ID", data.id);
  row("Name", data.name);
  row("Scopes", data.scopes?.includes("*") ? "All (full access)" : data.scopes?.join(", ") || "All");
  row("Expires", data.expiresAt ? new Date(data.expiresAt).toLocaleString() : "Never");
  blank();
  console.log(`  ${pc.yellow("!")} ${pc.bold("Key:")} ${data.key}`);
  console.log(`  ${pc.dim("Save this key - it will not be shown again.")}`);
  blank();
}

// ── Revoke ────────────────────────────────────────────

async function revokeToken(options: { json?: boolean; fields?: string; tokenId?: string }): Promise<void> {
  if (!options.tokenId) {
    fail("Token ID required", { hint: "Usage: domani tokens revoke --token-id <id>\nRun 'domani tokens list' to see your tokens.", code: "validation_error", json: options.json, fields: options.fields });
  }

  const s = createSpinner(!options.json);
  s.start("Revoking token");

  const res = await apiRequest(`/api/tokens/${encodeURIComponent(options.tokenId)}`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Token revoked`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  console.log(`  ${pc.dim("Any applications using this key will need a new one.")}`);
  blank();
}
