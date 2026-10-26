import { apiRequest } from "../api.js";
import { currentAccount } from "../config.js";
import pc from "picocolors";
import { S, heading, row, blank, jsonOut, fail } from "../ui.js";

export async function me(options: { json?: boolean; fields?: string }): Promise<void> {
  const [res, activationRes] = await Promise.all([
    apiRequest("/api/me"),
    apiRequest("/api/me/activation"),
  ]);
  const data = await res.json();

  if (!res.ok) {
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const activation = activationRes.ok ? await activationRes.json() : null;

  const account = currentAccount();
  const cliAccount = { name: account.name ?? null, source: account.source };

  if (options.json) {
    jsonOut({ ...data, activation, cli_account: cliAccount }, options.fields);
    return;
  }

  heading("Account");
  row("Email", pc.bold(data.email));
  row("CLI account", account.source === "api_key_env"
    ? pc.dim("DOMANI_API_KEY")
    : `${account.name ?? "-"}${account.source === "flag" ? pc.dim(" (--account)") : account.source === "env" ? pc.dim(" (DOMANI_ACCOUNT)") : ""}`);
  row("Payment", data.has_payment_method ? `${S.success} ${pc.green("active")}` : `${S.error} ${pc.dim("none")}`);
  row("Domains", String(data.domain_count));
  row("API tokens", String(data.token_count));
  row("Referral code", data.referral_code || pc.dim("-"));
  row("Created", new Date(data.created_at).toLocaleDateString());
  if (activation) {
    row("Activation", activation.status);
    const next = activation.recommended_actions?.[0];
    if (next) row("Next action", next.label);
  }
  blank();
}
