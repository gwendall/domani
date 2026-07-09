import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, table, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";

interface BrokerOptions {
  maxBudget?: string;
  status?: string;
  json?: boolean;
  fields?: string;
}

/**
 * Buyer-side broker: ask domani to acquire a taken, unlisted domain on your
 * behalf (source the owner, reach out anonymously, negotiate - commission-only).
 *   domani broker request <domain> [--max-budget N]
 *   domani broker list | broker
 *   domani broker status <id>
 *   domani broker cancel <id>
 */
export async function broker(action: string | undefined, arg: string | undefined, options: BrokerOptions): Promise<void> {
  switch (action) {
    case undefined:
    case "list":
    case "ls":
      return brokerList(options);
    case "request":
    case "acquire":
    case "new":
      return brokerRequest(arg, options);
    case "status":
    case "get":
      return brokerStatus(arg, options);
    case "cancel":
    case "rm":
      return brokerCancel(arg, options);
    default:
      // Bare `broker <domain>` = request; bare `broker <id>` = status.
      if (action.includes(".")) return brokerRequest(action, options);
      return brokerStatus(action, options);
  }
}

async function brokerRequest(domain: string | undefined, options: BrokerOptions): Promise<void> {
  if (!domain) fail("A domain is required.", { hint: "domani broker request dream.com --max-budget 5000", json: options.json });
  requireValidDomain(domain!, { json: options.json });

  const s = createSpinner(!options.json);
  s.start(`Requesting acquisition of ${fmt.domain(domain!)}`);

  const body: Record<string, unknown> = { domain };
  if (options.maxBudget) {
    const n = Number(options.maxBudget);
    if (!Number.isFinite(n) || n <= 0) fail("--max-budget must be a positive number (USD).", { json: options.json });
    body.max_budget = n;
  }

  const res = await apiRequest("/api/broker", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const r = data.request || data;
  s.stop(`${S.success} Acquisition requested`);
  if (options.json) return jsonOut(data, options.fields);

  heading("Broker request");
  row("Domain", fmt.domain(r.domain));
  row("Status", statusColor(r.status));
  if (r.max_budget != null) row("Max budget", fmt.price(r.max_budget));
  row("ID", pc.dim(r.id));
  blank();
  console.log(`  ${pc.dim("We'll source the owner and reach out anonymously. Commission-only - you pay nothing unless a deal closes.")}`);
  blank();
  hintCommand("Check progress:", `domani broker status ${r.id}`);
  blank();
}

async function brokerList(options: BrokerOptions): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading broker requests");

  const qs = options.status ? `?status=${encodeURIComponent(options.status)}` : "";
  const res = await apiRequest(`/api/broker${qs}`);
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const requests = data.requests || data.data || [];
  s.stop(`${S.success} ${requests.length} request(s)`);
  if (options.json) return jsonOut(data, options.fields);

  if (requests.length === 0) {
    blank();
    console.log(`  ${pc.dim("No broker requests yet.")}`);
    blank();
    hintCommand("Acquire a taken domain:", "domani broker request <domain> --max-budget <amount>");
    blank();
    return;
  }

  blank();
  heading("Broker requests");
  table(
    ["Domain", "Status", "Budget", "ID"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requests.map((r: any) => [fmt.domain(r.domain), statusColor(r.status), r.max_budget != null ? fmt.price(r.max_budget) : pc.dim("-"), pc.dim(r.id)]),
  );
  blank();
}

async function brokerStatus(id: string | undefined, options: BrokerOptions): Promise<void> {
  if (!id) fail("A request ID is required.", { hint: "domani broker status <id>  (list with: domani broker)", json: options.json });

  const s = createSpinner(!options.json);
  s.start("Loading request");
  const res = await apiRequest(`/api/broker/${encodeURIComponent(id!)}`);
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const r = data.request || data;
  s.stop(`${S.success} ${fmt.domain(r.domain)}`);
  if (options.json) return jsonOut(data, options.fields);

  heading("Broker request");
  row("Domain", fmt.domain(r.domain));
  row("Status", statusColor(r.status));
  if (r.max_budget != null) row("Max budget", fmt.price(r.max_budget));
  row("Contacted", r.contacted ? pc.green("yes") : pc.dim("not yet"));
  if (r.failure_reason) row("Reason", pc.yellow(r.failure_reason));
  row("ID", pc.dim(r.id));
  blank();
  if (r.negotiation_id) {
    console.log(`  ${pc.dim("The owner responded - an anonymous negotiation is open.")}`);
    blank();
    hintCommand("Review the offer:", `domani deals`);
    blank();
  } else if (["sourcing", "contacted", "negotiating"].includes(r.status)) {
    hintCommand("Cancel this request:", `domani broker cancel ${r.id}`);
    blank();
  }
}

async function brokerCancel(id: string | undefined, options: BrokerOptions): Promise<void> {
  if (!id) fail("A request ID is required.", { hint: "domani broker cancel <id>", json: options.json });

  const s = createSpinner(!options.json);
  s.start("Cancelling request");
  const res = await apiRequest(`/api/broker/${encodeURIComponent(id!)}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }
  s.stop(`${S.success} Request cancelled`);
  if (options.json) return jsonOut(data, options.fields);
  blank();
}

function statusColor(status: string): string {
  if (["completed", "agreed"].includes(status)) return pc.green(status);
  if (["negotiating", "contacted", "sourcing"].includes(status)) return pc.cyan(status);
  if (["declined", "no_contact", "failed", "expired", "cancelled"].includes(status)) return pc.dim(status);
  return status;
}
