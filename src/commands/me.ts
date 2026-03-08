import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, heading, row, blank, jsonOut, fail } from "../ui.js";

export async function me(options: { json?: boolean; fields?: string }): Promise<void> {
  const res = await apiRequest("/api/me");
  const data = await res.json();

  if (!res.ok) {
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Account");
  row("Email", pc.bold(data.email));
  row("Payment", data.has_payment_method ? `${S.success} ${pc.green("active")}` : `${S.error} ${pc.dim("none")}`);
  row("Domains", String(data.domain_count));
  row("API tokens", String(data.token_count));
  row("Referral code", data.referral_code || pc.dim("-"));
  row("Created", new Date(data.created_at).toLocaleDateString());
  blank();
}
