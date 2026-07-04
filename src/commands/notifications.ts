import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, heading, blank, table, createSpinner, jsonOut, fail } from "../ui.js";

export async function notifications(
  options: {
    read?: boolean;
    unread?: boolean;
    limit?: string;
    json?: boolean;
    fields?: string;
  }
): Promise<void> {
  if (options.read) return markAllRead(options);
  return listNotifications(options);
}

// -- List notifications ──────────────────────────────

async function listNotifications(options: {
  unread?: boolean;
  limit?: string;
  json?: boolean;
  fields?: string;
}): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading notifications");

  const params = new URLSearchParams();
  if (options.unread) params.set("unread", "true");
  if (options.limit) params.set("limit", options.limit);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const res = await apiRequest(`/api/notifications${qs}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const items = data.notifications || data.data || [];
  const unreadCount = data.unread_count ?? items.filter((n: { read: boolean }) => !n.read).length;
  s.stop(`${S.success} ${items.length} notification(s)${unreadCount > 0 ? ` ${S.dot} ${pc.yellow(`${unreadCount} unread`)}` : ""}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (items.length === 0) {
    blank();
    console.log(`  ${pc.dim("No notifications.")}`);
    blank();
    return;
  }

  blank();
  heading("Notifications");
  const rows = items.map(
    (n: { type: string; title: string; body?: string; read: boolean; created_at: string }) => {
      const readIcon = n.read ? pc.dim(S.dot) : pc.cyan(S.info);
      const typeLabel = formatType(n.type);
      const title = n.read ? pc.dim(n.title) : pc.white(n.title);
      const body = n.body ? (n.read ? pc.dim(truncate(n.body, 40)) : pc.dim(truncate(n.body, 40))) : pc.dim("-");
      const date = pc.dim(new Date(n.created_at).toLocaleDateString());
      return [readIcon, typeLabel, title, body, date];
    }
  );
  table(["", "Type", "Title", "Body", "Date"], rows, [3, 16, 28, 42, 14]);
  blank();

  if (unreadCount > 0) {
    console.log(`  ${pc.dim("Mark all as read:")} ${pc.cyan("domani notifications --read")}`);
    blank();
  }
}

// -- Mark all as read ────────────────────────────────

async function markAllRead(options: {
  json?: boolean;
  fields?: string;
}): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Marking all notifications as read");

  const res = await apiRequest("/api/notifications/read-all", {
    method: "POST",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  if (options.json) {
    s.stop("");
    jsonOut(data, options.fields);
    return;
  }

  const count = data.count ?? 0;
  s.stop(`${S.success} ${count} notification(s) marked as read`);
  blank();
}

// -- Helpers ─────────────────────────────────────────

function formatType(type: string): string {
  const colors: Record<string, (s: string) => string> = {
    deal: pc.cyan,
    sale: pc.green,
    purchase: pc.green,
    transfer: pc.yellow,
    expiry: pc.red,
    security: pc.red,
    billing: pc.yellow,
    email: pc.blue,
  };
  const prefix = type.split(".")[0].split("_")[0];
  const colorFn = colors[prefix] || pc.dim;
  return colorFn(type);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}
