import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, table, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";

export async function deals(
  id: string | undefined,
  options: {
    role?: string;
    status?: string;
    json?: boolean;
    fields?: string;
  }
): Promise<void> {
  if (id) return dealDetail(id, options);
  return dealList(options);
}

// -- List deals ──────────────────────────────────────

async function dealList(options: {
  role?: string;
  status?: string;
  json?: boolean;
  fields?: string;
}): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading deals");

  const params = new URLSearchParams();
  if (options.role) params.set("role", options.role);
  if (options.status) params.set("status", options.status);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const res = await apiRequest(`/api/deals${qs}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const dealsList = data.deals || data.data || [];
  s.stop(`${S.success} ${dealsList.length} deal(s)`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (dealsList.length === 0) {
    blank();
    console.log(`  ${pc.dim("No deals found.")}`);
    blank();
    hintCommand("List a domain for sale:", "domani sell <domain> --price <amount>");
    blank();
    return;
  }

  blank();
  heading("Deals");
  const rows = dealsList.map(
    (d: { id: string; domain: string; price: number; status: string; role: string; created_at: string }) => {
      const statusColor =
        d.status === "completed" ? pc.green
          : d.status === "active" ? pc.cyan
          : d.status === "cancelled" ? pc.red
          : pc.yellow;
      return [
        fmt.domain(d.domain),
        fmt.price(d.price),
        statusColor(d.status),
        pc.dim(d.role || "-"),
        pc.dim(new Date(d.created_at).toLocaleDateString()),
      ];
    }
  );
  table(["Domain", "Price", "Status", "Role", "Created"], rows, [28, 12, 14, 10, 14]);
  blank();
}

// -- Deal detail ─────────────────────────────────────

async function dealDetail(
  id: string,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  const s = createSpinner(!options.json);
  s.start(`Loading deal ${pc.dim(id)}`);

  const res = await apiRequest(`/api/deals/${encodeURIComponent(id)}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Deal loaded`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  const deal = data.deal || data;

  heading("Deal Details");
  row("ID", pc.dim(deal.id));
  row("Domain", fmt.domain(deal.domain));
  row("Price", fmt.price(deal.price));
  const statusColor =
    deal.status === "completed" ? pc.green
      : deal.status === "active" ? pc.cyan
      : deal.status === "cancelled" ? pc.red
      : pc.yellow;
  row("Status", statusColor(deal.status));
  if (deal.role) row("Your Role", deal.role);
  if (deal.buyer) row("Buyer", pc.dim(deal.buyer));
  if (deal.seller) row("Seller", pc.dim(deal.seller));
  if (deal.created_at) row("Created", pc.dim(new Date(deal.created_at).toLocaleDateString()));
  if (deal.updated_at) row("Updated", pc.dim(new Date(deal.updated_at).toLocaleDateString()));
  blank();

  // Events timeline
  const events = deal.events || [];
  if (events.length > 0) {
    heading("Timeline");
    for (const evt of events as { status: string; detail?: string | null; created_at: string }[]) {
      const date = pc.dim(new Date(evt.created_at).toLocaleString());
      const icon =
        evt.status === "completed" ? S.success
          : evt.status === "expired" || evt.status === "refunded" ? S.error
          : S.info;
      console.log(`  ${icon} ${date}  ${evt.detail || evt.status}`);
    }
    blank();
  }

  if ((deal.status === "escrow_held" || deal.status === "epp_pending") && deal.role === "seller") {
    hintCommand("Submit transfer code:", `domani sell ${deal.domain} --transfer-code <code>`);
    blank();
  }
}
