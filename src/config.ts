import fs from "fs";
import path from "path";
import os from "os";
import { APP_URL } from "./brand.js";
import { keychainAvailable, keychainGet, keychainSet, keychainDelete } from "./keychain.js";

function configDir(): string {
  return process.env.DOMANI_CONFIG_DIR || path.join(os.homedir(), ".domani");
}

function configFile(): string {
  return path.join(configDir(), "config.json");
}

// Allow --api-url global override
let apiUrlOverride: string | undefined;

export function setApiUrlOverride(url: string): void {
  apiUrlOverride = url;
}

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24h

/** One saved Domani login. The token lives in the OS keychain when it can. */
export interface AccountEntry {
  email?: string;
  api_url?: string;
  token?: string;
  /** True when the token lives in the OS keychain instead of this file. */
  token_in_keychain?: boolean;
}

export interface Config {
  /** API URL kept across logouts (local dev setups). */
  api_url?: string;
  /** The account every command uses unless --account or DOMANI_ACCOUNT says otherwise. */
  active_account?: string;
  accounts?: Record<string, AccountEntry>;
}

/** The single-session layout (CLI <= 0.4.78): the login sat at the top level. */
interface LegacyConfig extends Config {
  token?: string;
  email?: string;
  token_in_keychain?: boolean;
}

export const DEFAULT_ACCOUNT = "default";
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

export function isValidAccountName(name: string): boolean {
  return ACCOUNT_NAME.test(name);
}

/**
 * Reads the config file, turning a single-session file into the `default`
 * account in memory. The keychain entry of that session is already the
 * `default` account's, so nobody is logged out by the upgrade; the file is
 * rewritten in the new layout on the next save.
 */
export function getConfig(): Config {
  let raw: LegacyConfig;
  try {
    raw = JSON.parse(fs.readFileSync(configFile(), "utf-8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const { token, email, token_in_keychain, ...rest } = raw;
  const config: Config = { ...rest, accounts: { ...(raw.accounts ?? {}) } };
  if (!raw.accounts && (token || email || token_in_keychain)) {
    config.accounts = {
      [DEFAULT_ACCOUNT]: {
        email,
        api_url: raw.api_url,
        ...(token ? { token } : {}),
        ...(token_in_keychain ? { token_in_keychain } : {}),
      },
    };
    config.active_account = DEFAULT_ACCOUNT;
  }
  return config;
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ── Accounts ──────────────────────────────────────────

let accountOverride: string | undefined;

/** Set by the global --account option. */
export function setAccountOverride(name: string | undefined): void {
  accountOverride = name;
}

export type AccountSource = "api_key_env" | "flag" | "env" | "active" | "none";

/**
 * Which credential a command acts with. Precedence: DOMANI_API_KEY, then
 * --account, then DOMANI_ACCOUNT, then the active account (`domani use`).
 */
export function currentAccount(): { name?: string; source: AccountSource } {
  if (process.env.DOMANI_API_KEY) return { source: "api_key_env" };
  return selectedAccount();
}

/** Like currentAccount, ignoring DOMANI_API_KEY: the saved login a command reads or writes. */
export function selectedAccount(): { name?: string; source: AccountSource } {
  if (accountOverride) return { name: accountOverride, source: "flag" };
  if (process.env.DOMANI_ACCOUNT) return { name: process.env.DOMANI_ACCOUNT, source: "env" };
  const active = getConfig().active_account;
  if (active) return { name: active, source: "active" };
  return { source: "none" };
}

/** The account `domani login` and `domani logout` act on. */
export function targetAccountName(): string {
  return selectedAccount().name ?? DEFAULT_ACCOUNT;
}

export function getAccount(name: string): AccountEntry | undefined {
  return getConfig().accounts?.[name];
}

export function listAccounts(): Array<{ name: string } & AccountEntry> {
  const accounts = getConfig().accounts ?? {};
  return Object.keys(accounts)
    .sort()
    .map((name) => ({ name, ...accounts[name] }));
}

export function accountToken(name: string, options: { refreshKeychain?: boolean } = {}): string | undefined {
  const account = getAccount(name);
  if (!account) return undefined;
  // A plaintext token wins if present (pre-keychain installs, or no keychain);
  // it moves into the keychain on the next saveAccount (e.g. next login).
  if (account.token) return account.token;
  if (account.token_in_keychain) return keychainGet(name, { refresh: options.refreshKeychain });
  return undefined;
}

/** Saves a login under `name`. The first saved account becomes the active one. */
export function saveAccount(name: string, entry: { token: string; email?: string; api_url?: string }): void {
  const config = getConfig();
  // Prefer the OS keychain for the secret; the config file then only holds
  // non-sensitive settings + a marker. Plaintext file is the fallback for
  // platforms without a keychain (perms 0600 either way).
  const stored: AccountEntry = keychainAvailable() && keychainSet(name, entry.token)
    ? { email: entry.email, api_url: entry.api_url, token_in_keychain: true }
    : { email: entry.email, api_url: entry.api_url, token: entry.token };
  config.accounts = { ...(config.accounts ?? {}), [name]: stored };
  if (!config.active_account || !config.accounts[config.active_account]) config.active_account = name;
  saveConfig(config);
}

/** Forgets a saved login. Returns it, or undefined when there was none. */
export function removeAccount(name: string): AccountEntry | undefined {
  const config = getConfig();
  const entry = config.accounts?.[name];
  if (!entry) return undefined;
  if (entry.token_in_keychain) keychainDelete(name);
  delete config.accounts![name];
  if (config.active_account === name) delete config.active_account;
  saveConfig(config);
  return entry;
}

export function setActiveAccount(name: string): boolean {
  const config = getConfig();
  if (!config.accounts?.[name]) return false;
  config.active_account = name;
  saveConfig(config);
  return true;
}

/** A short label for the credential in use, for confirmations before paid actions. */
export function actingAsLabel(): string | undefined {
  const current = currentAccount();
  if (current.source === "api_key_env") return "DOMANI_API_KEY";
  if (!current.name) return undefined;
  const email = getAccount(current.name)?.email;
  if (listAccounts().length <= 1 && current.source === "active") return email;
  return email ? `${current.name} (${email})` : current.name;
}

export function getApiUrl(): string {
  if (apiUrlOverride) return apiUrlOverride;
  const config = getConfig();
  const { name } = selectedAccount();
  return (name && config.accounts?.[name]?.api_url) || config.api_url || APP_URL;
}

export function getToken(options: { refreshKeychain?: boolean } = {}): string | undefined {
  if (process.env.DOMANI_API_KEY) return process.env.DOMANI_API_KEY;
  const { name } = selectedAccount();
  return name ? accountToken(name, options) : undefined;
}

export function requireToken(): string {
  const token = getToken();
  if (!token) {
    const { name, source } = selectedAccount();
    const loginCommand = source === "flag" || source === "env" ? `domani login --account ${name}` : "domani login";
    if (process.argv.includes("--json") || !process.stdout.isTTY) {
      console.log(JSON.stringify({
        error: "Not logged in",
        code: "auth_required",
        hint: `Run '${loginCommand}' or set DOMANI_API_KEY environment variable`,
        fix_command: loginCommand,
      }, null, 2));
    } else {
      console.error(`Not logged in. Run: ${loginCommand}`);
    }
    process.exit(1);
  }
  return token;
}

export const isTTY = process.stdout.isTTY ?? false;

declare const __CLI_VERSION__: string;
export const CLI_VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

interface VersionInfo {
  version: string;
  min: string;
  checkedAt: number;
}

function getCachedVersion(): VersionInfo | null {
  try {
    const data = fs.readFileSync(path.join(configDir(), "version-check.json"), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function cacheVersion(info: VersionInfo): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(configDir(), "version-check.json"), JSON.stringify(info), { mode: 0o600 });
  } catch {
    // ignore write errors
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function checkVersion(): Promise<{ update?: string; forced?: boolean } | null> {
  const cached = getCachedVersion();
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL) {
    if (compareVersions(cached.version, CLI_VERSION) > 0) {
      return {
        update: cached.version,
        forced: compareVersions(CLI_VERSION, cached.min) < 0,
      };
    }
    return null;
  }

  try {
    const apiUrl = getApiUrl();
    const res = await fetch(`${apiUrl}/api/cli/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    cacheVersion({ version: data.version, min: data.min, checkedAt: Date.now() });

    if (compareVersions(data.version, CLI_VERSION) > 0) {
      return {
        update: data.version,
        forced: compareVersions(CLI_VERSION, data.min) < 0,
      };
    }
  } catch {
    // network error, skip check
  }
  return null;
}
