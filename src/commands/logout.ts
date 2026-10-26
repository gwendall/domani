import { getConfig, listAccounts, removeAccount, targetAccountName } from "../config.js";
import pc from "picocolors";
import { S, hintCommand, jsonOut } from "../ui.js";

export async function logout(options: { json?: boolean }): Promise<void> {
  const account = targetAccountName();
  const removed = removeAccount(account);
  if (!removed) {
    if (options.json) {
      jsonOut({ status: "not_logged_in", account });
    } else {
      console.log(`  ${pc.dim(`Not logged in${account === "default" ? "" : ` to the account "${account}"`}.`)}`);
    }
    return;
  }

  const remaining = listAccounts().map((a) => a.name);
  if (options.json) {
    jsonOut({ status: "logged_out", account, email: removed.email || null, remaining_accounts: remaining });
    return;
  }
  const who = [removed.email, remaining.length > 0 || account !== "default" ? `account ${account}` : undefined].filter(Boolean).join(", ");
  console.log(`  ${S.success} Logged out${who ? ` ${pc.dim(`(${who})`)}` : ""}`);
  if (remaining.length > 0 && !getConfig().active_account) hintCommand("Pick the account to use next:", `domani use ${remaining[0]}`);
}
