import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, heading, blank, jsonOut, fail } from "../ui.js";

export async function invoices(options: { json?: boolean; fields?: string; limit?: string }): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 20;
  const res = await apiRequest(`/api/billing/invoices?limit=${limit}`);
  const data = await res.json();

  if (!res.ok) {
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  if (options.json) {
    jsonOut({ ...data, count: data.invoices.length }, options.fields);
    return;
  }

  if (data.invoices.length === 0) {
    console.log(`  ${pc.dim("No invoices yet.")}`);
    return;
  }

  heading(`Invoices (${data.invoices.length})`);
  blank();

  for (const inv of data.invoices) {
    const amount = `$${(inv.amount_paid / 100).toFixed(2)}`;
    const date = new Date(inv.created).toLocaleDateString();
    const num = inv.number || inv.id;

    console.log(`  ${S.success} ${pc.bold(num)}  ${pc.green(amount)}  ${pc.dim(date)}`);
    if (inv.description) {
      console.log(`    ${pc.dim(inv.description)}`);
    }
    if (inv.hosted_invoice_url) {
      console.log(`    ${pc.dim(inv.hosted_invoice_url)}`);
    }
  }

  blank();
  if (data.has_more) {
    console.log(`  ${pc.dim(`Showing ${data.invoices.length} most recent. Use --limit to see more.`)}`);
    blank();
  }
}
