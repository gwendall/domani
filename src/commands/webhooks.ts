import { apiRequest, publicRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, table, hintCommand, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";

export async function webhooks(
  action: string | undefined,
  options: {
    dryRun?: boolean;
    json?: boolean;
    fields?: string;
    url?: string;
    events?: string;
    webhookId?: string;
    active?: string;
    limit?: string;
  },
): Promise<void> {
  switch (action) {
    case undefined:
    case "list":
      return listWebhooks(options.json, options.fields);
    case "create":
      return createWebhook(options);
    case "update":
      return updateWebhook(options);
    case "delete":
      return deleteWebhook(options);
    case "deliveries":
      return listDeliveries(options);
    case "events":
      return listEvents(options.json, options.fields);
    default:
      fail(`Unknown action: ${action}`, { hint: "Actions: list, create, update, delete, deliveries, events", code: "validation_error", json: options.json, fields: options.fields });
  }
}

// ── List ──────────────────────────────────────────────

async function listWebhooks(json?: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start("Loading webhooks");

  const res = await apiRequest("/api/webhooks");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop(`${S.success} ${data.webhooks.length} webhook(s)`);

  if (json) {
    jsonOut(data, fields);
    return;
  }

  if (data.webhooks.length === 0) {
    blank();
    console.log(`  ${pc.dim("No webhooks configured.")}`);
    blank();
    hintCommand("Create one:", "domani webhooks create --url https://... --events domain.purchased,dns.updated");
    hintCommand("List events:", "domani webhooks events");
    blank();
    return;
  }

  blank();
  heading("Webhooks");
  const rows = data.webhooks.map((w: { id: string; url: string; events: string[]; active: boolean }) => [
    pc.dim(w.id),
    fmt.url(w.url),
    w.events.length <= 3 ? w.events.join(", ") : `${w.events.length} events`,
    w.active ? pc.green("active") : pc.dim("paused"),
  ]);
  table(["ID", "URL", "Events", "Status"], rows, [28, 40, 24, 10]);
  blank();
}

// ── Create ────────────────────────────────────────────

async function createWebhook(options: { dryRun?: boolean; json?: boolean; fields?: string; url?: string; events?: string }): Promise<void> {
  if (!options.url) {
    fail("URL required", { hint: "Usage: domani webhooks create --url https://example.com/hook --events domain.purchased,dns.updated", code: "validation_error", json: options.json, fields: options.fields });
  }
  if (!options.events) {
    fail("Events required", { hint: "Usage: domani webhooks create --url https://... --events domain.purchased,dns.updated\nRun 'domani webhooks events' to see available event types.", code: "validation_error", json: options.json, fields: options.fields });
  }

  const events = options.events.split(",").map((e) => e.trim());

  if (options.dryRun) {
    return dryRunOut("webhook_create", { url: options.url, events }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start("Creating webhook");

  const res = await apiRequest("/api/webhooks", {
    method: "POST",
    body: JSON.stringify({ url: options.url, events }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Webhook created`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  heading("Webhook Created");
  row("ID", data.id);
  row("URL", fmt.url(data.url));
  row("Events", data.events.join(", "));
  row("Status", pc.green("active"));
  blank();
  console.log(`  ${pc.yellow("!")} ${pc.bold("Secret:")} ${data.secret}`);
  console.log(`  ${pc.dim("Save this secret - it won't be shown again.")}`);
  console.log(`  ${pc.dim("Use it to verify payloads with HMAC-SHA256.")}`);
  blank();
}

// ── Update ────────────────────────────────────────────

async function updateWebhook(options: {
  dryRun?: boolean;
  json?: boolean;
  fields?: string;
  webhookId?: string;
  url?: string;
  events?: string;
  active?: string;
}): Promise<void> {
  if (!options.webhookId) {
    fail("Webhook ID required", { hint: "Usage: domani webhooks update --webhook-id <id> [--url ...] [--events ...] [--active on|off]", code: "validation_error", json: options.json, fields: options.fields });
  }

  const body: Record<string, unknown> = {};
  if (options.url) body.url = options.url;
  if (options.events) body.events = options.events.split(",").map((e) => e.trim());
  if (options.active !== undefined) body.active = options.active === "on" || options.active === "true";

  if (options.dryRun) {
    return dryRunOut("webhook_update", { webhook_id: options.webhookId, ...body }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start("Updating webhook");

  const res = await apiRequest(`/api/webhooks/${encodeURIComponent(options.webhookId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Webhook updated`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Webhook Updated");
  row("ID", data.id);
  row("URL", fmt.url(data.url));
  row("Events", data.events.join(", "));
  row("Status", data.active ? pc.green("active") : pc.dim("paused"));
  blank();
}

// ── Delete ────────────────────────────────────────────

async function deleteWebhook(options: { dryRun?: boolean; json?: boolean; fields?: string; webhookId?: string }): Promise<void> {
  if (!options.webhookId) {
    fail("Webhook ID required", { hint: "Usage: domani webhooks delete --webhook-id <id>", code: "validation_error", json: options.json, fields: options.fields });
  }

  if (options.dryRun) {
    return dryRunOut("webhook_delete", { webhook_id: options.webhookId }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start("Deleting webhook");

  const res = await apiRequest(`/api/webhooks/${encodeURIComponent(options.webhookId)}`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Webhook deleted`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  console.log(`  ${pc.dim("Pending deliveries have been cancelled.")}`);
  blank();
}

// ── Deliveries ────────────────────────────────────────

async function listDeliveries(options: { json?: boolean; fields?: string; webhookId?: string; limit?: string }): Promise<void> {
  if (!options.webhookId) {
    fail("Webhook ID required", { hint: "Usage: domani webhooks deliveries --webhook-id <id> [--limit 20]", code: "validation_error", json: options.json, fields: options.fields });
  }

  const limitParam = options.limit ? `?limit=${options.limit}` : "";

  const s = createSpinner(!options.json);
  s.start("Loading deliveries");

  const res = await apiRequest(`/api/webhooks/${encodeURIComponent(options.webhookId)}/deliveries${limitParam}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} ${data.deliveries.length} delivery(ies)`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (data.deliveries.length === 0) {
    blank();
    console.log(`  ${pc.dim("No deliveries yet.")}`);
    blank();
    return;
  }

  blank();
  heading("Deliveries");
  const rows = data.deliveries.map((d: { event_type: string; status: string; http_status: number | null; attempts: number; created_at: string }) => {
    const statusIcon = d.status === "delivered" ? pc.green("delivered")
      : d.status === "failed" ? pc.red("failed")
      : pc.yellow("pending");
    return [
      d.event_type,
      statusIcon,
      d.http_status ? String(d.http_status) : pc.dim("-"),
      String(d.attempts),
      pc.dim(new Date(d.created_at).toLocaleString()),
    ];
  });
  table(["Event", "Status", "HTTP", "Tries", "Date"], rows, [22, 12, 6, 6, 22]);
  blank();
}

// ── Events ────────────────────────────────────────────

async function listEvents(json?: boolean, fields?: string): Promise<void> {
  const s = createSpinner(!json);
  s.start("Loading event types");

  const res = await publicRequest("/api/webhooks/events");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop(`${S.success} ${data.events.length} event type(s)`);

  if (json) {
    jsonOut(data, fields);
    return;
  }

  blank();
  heading("Webhook Event Types");
  const rows = data.events.map((e: { type: string; description: string }) => [
    pc.cyan(e.type),
    pc.dim(e.description),
  ]);
  table(["Event", "Description"], rows, [24, 50]);
  blank();
}
