import pc from "picocolors";
import { currentAccount, getConfig, isValidAccountName, listAccounts, setActiveAccount } from "../config.js";
import { S, heading, blank, hintCommand, jsonOut, fail } from "../ui.js";

const SOURCE_LABEL = {
  api_key_env: "DOMANI_API_KEY",
  flag: "--account",
  env: "DOMANI_ACCOUNT",
  active: "domani use",
  none: "none",
} as const;

export async function accounts(options: { json?: boolean }): Promise<void> {
  const saved = listAccounts();
  const active = getConfig().active_account ?? null;
  const current = currentAccount();

  if (options.json) {
    jsonOut({
      active,
      current: current.name ?? null,
      source: current.source,
      accounts: saved.map((a) => ({
        name: a.name,
        email: a.email ?? null,
        api_url: a.api_url ?? null,
        active: a.name === active,
        current: a.name === current.name,
      })),
    });
    return;
  }

  if (saved.length === 0) {
    console.log(`  ${pc.dim("No saved accounts.")}`);
    hintCommand("Log in:", "domani login");
    return;
  }

  heading("Accounts");
  const width = Math.max(...saved.map((a) => a.name.length));
  for (const a of saved) {
    const mark = a.name === current.name ? pc.green("*") : " ";
    const tags = [
      a.name === active ? "active" : undefined,
      a.name === current.name && current.source !== "active" ? `selected by ${SOURCE_LABEL[current.source]}` : undefined,
    ].filter(Boolean);
    console.log(`  ${mark} ${pc.bold(a.name.padEnd(width))}  ${a.email ?? pc.dim("unknown email")}${tags.length ? `  ${pc.dim(tags.join(", "))}` : ""}`);
  }
  if (current.source === "api_key_env") {
    blank();
    console.log(`  ${S.warning} ${pc.dim("DOMANI_API_KEY is set: every command uses that key, not these accounts.")}`);
  }
  blank();
  hintCommand("Switch:", "domani use <name>");
  hintCommand("Add one:", "domani login --account <name>");
  blank();
}

export async function use(name: string, options: { json?: boolean }): Promise<void> {
  if (!isValidAccountName(name)) {
    fail(`Invalid account name: ${name}`, { code: "validation_error", hint: "Use letters, digits, dot, dash or underscore", json: options.json });
  }
  if (!setActiveAccount(name)) {
    const names = listAccounts().map((a) => a.name);
    fail(`No saved account named "${name}"`, {
      code: "account_not_found",
      hint: names.length ? `Saved accounts: ${names.join(", ")}. Add one with 'domani login --account ${name}'` : `Log in with 'domani login --account ${name}'`,
      json: options.json,
    });
  }
  const email = listAccounts().find((a) => a.name === name)?.email ?? null;
  if (options.json) {
    jsonOut({ status: "switched", active: name, email });
    return;
  }
  console.log(`  ${S.success} Now using ${pc.bold(name)}${email ? ` ${pc.dim(`(${email})`)}` : ""}`);
  if (process.env.DOMANI_ACCOUNT && process.env.DOMANI_ACCOUNT !== name) {
    console.log(`  ${S.warning} ${pc.dim(`DOMANI_ACCOUNT=${process.env.DOMANI_ACCOUNT} still overrides it in this shell.`)}`);
  }
}
