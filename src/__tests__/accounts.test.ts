import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actingAsLabel,
  currentAccount,
  getApiUrl,
  getConfig,
  getToken,
  listAccounts,
  removeAccount,
  saveAccount,
  setAccountOverride,
  setActiveAccount,
} from "../config.js";
import { setKeychainBackend, type KeychainBackend } from "../keychain.js";
import { proxyMcpPayload } from "../mcp-bridge.js";

// Never touch the real ~/.domani or the OS keychain: every test gets a temp
// config dir and an in-memory keychain.
let dir: string;
let keychain: Map<string, string>;
let keychainOn: boolean;

const memoryKeychain: KeychainBackend = {
  available: () => keychainOn,
  get: (account) => keychain.get(account),
  set: (account, token) => {
    if (!keychainOn) return false;
    keychain.set(account, token);
    return true;
  },
  delete: (account) => {
    keychain.delete(account);
  },
};

const configPath = () => path.join(dir, "config.json");
const writeRaw = (value: unknown) => fs.writeFileSync(configPath(), JSON.stringify(value));
const readRaw = () => JSON.parse(fs.readFileSync(configPath(), "utf-8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-accounts-"));
  process.env.DOMANI_CONFIG_DIR = dir;
  delete process.env.DOMANI_API_KEY;
  delete process.env.DOMANI_ACCOUNT;
  keychain = new Map();
  keychainOn = true;
  setKeychainBackend(memoryKeychain);
  setAccountOverride(undefined);
});

afterEach(() => {
  setKeychainBackend(null);
  setAccountOverride(undefined);
  delete process.env.DOMANI_ACCOUNT;
  delete process.env.DOMANI_API_KEY;
});

test("a single-session keychain login becomes the default account without logging out", () => {
  writeRaw({ email: "me@acme.com", api_url: "https://domani.run", token_in_keychain: true });
  keychain.set("default", "tok-default");

  assert.equal(getToken(), "tok-default");
  assert.deepEqual(currentAccount(), { name: "default", source: "active" });
  assert.deepEqual(listAccounts(), [
    { name: "default", email: "me@acme.com", api_url: "https://domani.run", token_in_keychain: true },
  ]);
  // Reading never rewrites the file.
  assert.deepEqual(readRaw(), { email: "me@acme.com", api_url: "https://domani.run", token_in_keychain: true });

  saveAccount("work", { token: "tok-work", email: "me@work.com", api_url: "https://domani.run" });
  const saved = readRaw();
  assert.equal(saved.active_account, "default");
  assert.equal(saved.email, undefined);
  assert.equal(saved.token_in_keychain, undefined);
  assert.deepEqual(Object.keys(saved.accounts).sort(), ["default", "work"]);
  assert.equal(getToken(), "tok-default");
  assert.equal(keychain.get("default"), "tok-default");
  assert.equal(keychain.get("work"), "tok-work");
});

test("a plaintext single-session token migrates and moves into the keychain on the next save", () => {
  writeRaw({ token: "tok-plain", email: "me@acme.com" });
  assert.equal(getToken(), "tok-plain");

  saveAccount("default", { token: "tok-plain", email: "me@acme.com" });
  const saved = readRaw();
  assert.equal(saved.token, undefined);
  assert.equal(saved.accounts.default.token, undefined);
  assert.equal(saved.accounts.default.token_in_keychain, true);
  assert.equal(keychain.get("default"), "tok-plain");
});

test("without a keychain the token stays in a 0600 config file", () => {
  keychainOn = false;
  saveAccount("ci", { token: "tok-ci", email: "ci@acme.com" });
  assert.equal(readRaw().accounts.ci.token, "tok-ci");
  assert.equal(fs.statSync(configPath()).mode & 0o777, 0o600);
  assert.equal(getToken(), "tok-ci");
});

test("the first saved account becomes active, later ones do not", () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  saveAccount("work", { token: "tok-w", email: "me@work.com" });
  assert.equal(getConfig().active_account, "personal");
  assert.equal(getToken(), "tok-p");
});

test("precedence: DOMANI_API_KEY, then --account, then DOMANI_ACCOUNT, then the active account", () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  saveAccount("work", { token: "tok-w", email: "me@work.com" });
  saveAccount("client", { token: "tok-c", email: "me@client.com" });

  assert.equal(getToken(), "tok-p");

  process.env.DOMANI_ACCOUNT = "client";
  assert.equal(getToken(), "tok-c");
  assert.deepEqual(currentAccount(), { name: "client", source: "env" });

  setAccountOverride("work");
  assert.equal(getToken(), "tok-w");
  assert.deepEqual(currentAccount(), { name: "work", source: "flag" });

  process.env.DOMANI_API_KEY = "domani_sk_env";
  assert.equal(getToken(), "domani_sk_env");
  assert.deepEqual(currentAccount(), { source: "api_key_env" });
  assert.equal(actingAsLabel(), "DOMANI_API_KEY");
});

test("an unknown selected account has no token, so commands ask to log into it", () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  setAccountOverride("work");
  assert.equal(getToken(), undefined);
});

test("domani use switches the active account and refuses unknown names", () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  saveAccount("work", { token: "tok-w", email: "me@work.com" });
  assert.equal(setActiveAccount("work"), true);
  assert.equal(getToken(), "tok-w");
  assert.equal(setActiveAccount("nope"), false);
  assert.equal(getConfig().active_account, "work");
});

test("logging out of the active account clears it and its keychain entry, keeps the others", () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  saveAccount("work", { token: "tok-w", email: "me@work.com" });
  writeRaw({ ...readRaw(), api_url: "http://localhost:3000" });

  assert.equal(removeAccount("personal")?.email, "me@acme.com");
  assert.equal(keychain.has("personal"), false);
  assert.equal(keychain.get("work"), "tok-w");
  assert.equal(getConfig().active_account, undefined);
  assert.equal(getToken(), undefined);
  assert.equal(getConfig().api_url, "http://localhost:3000");
  assert.equal(removeAccount("personal"), undefined);
});

test("each account keeps its own API URL", () => {
  saveAccount("prod", { token: "a", api_url: "https://domani.run" });
  saveAccount("local", { token: "b", api_url: "http://localhost:3000" });
  assert.equal(getApiUrl(), "https://domani.run");
  setAccountOverride("local");
  assert.equal(getApiUrl(), "http://localhost:3000");
});

test("confirmations name the account when there is more than one", () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  assert.equal(actingAsLabel(), "me@acme.com");
  saveAccount("work", { token: "tok-w", email: "me@work.com" });
  assert.equal(actingAsLabel(), "personal (me@acme.com)");
  setAccountOverride("work");
  assert.equal(actingAsLabel(), "work (me@work.com)");
});

test("an MCP bridge pinned to an account uses its token and names it when it is missing", async () => {
  saveAccount("personal", { token: "tok-p", email: "me@acme.com" });
  saveAccount("work", { token: "tok-w", email: "me@work.com" });
  process.env.DOMANI_ACCOUNT = "work";
  let sent = "";
  await proxyMcpPayload({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {
    apiUrl: "https://domani.run",
    fetchImpl: async (_url, init) => {
      sent = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(sent, "Bearer tok-w");

  process.env.DOMANI_ACCOUNT = "client";
  const [error] = await proxyMcpPayload({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {
    apiUrl: "https://domani.run",
    fetchImpl: async () => new Response("Unauthorized", { status: 401 }),
  });
  assert.equal((error as any).error.data.fix_command, "npx -y domani-cli@latest login --account client");
});

// ── The commands, end to end in a subprocess ─────────────
// Plaintext tokens only, so the subprocess never reaches the OS keychain.

const cliEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const tsx = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", ".bin", "tsx");

function cli(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(tsx, [cliEntry, "--api-url", "http://127.0.0.1:9", ...args], {
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, DOMANI_CONFIG_DIR: dir, DOMANI_API_KEY: "", DOMANI_ACCOUNT: "", ...env },
  });
  return { status: res.status, stdout: res.stdout, json: () => JSON.parse(res.stdout) };
}

test("domani accounts, use and logout --account work on a saved config", () => {
  writeRaw({
    active_account: "personal",
    accounts: {
      personal: { email: "me@acme.com", token: "tok-p" },
      work: { email: "me@work.com", token: "tok-w" },
    },
  });

  const listed = cli(["accounts", "--json"]).json();
  assert.equal(listed.active, "personal");
  assert.equal(listed.current, "personal");
  assert.deepEqual(listed.accounts.map((a: { name: string; current: boolean }) => [a.name, a.current]), [["personal", true], ["work", false]]);
  assert.doesNotMatch(JSON.stringify(listed), /tok-/);

  const flagged = cli(["accounts", "--json", "--account", "work"]).json();
  assert.equal(flagged.current, "work");
  assert.equal(flagged.source, "flag");
  assert.equal(cli(["accounts", "--json"], { DOMANI_ACCOUNT: "work" }).json().source, "env");

  assert.equal(cli(["use", "work", "--json"]).json().active, "work");
  assert.equal(readRaw().active_account, "work");
  const unknown = cli(["use", "nope", "--json"]);
  assert.notEqual(unknown.status, 0);
  assert.equal(unknown.json().code, "account_not_found");

  const out = cli(["logout", "--account", "personal", "--json"]).json();
  assert.equal(out.status, "logged_out");
  assert.deepEqual(out.remaining_accounts, ["work"]);
  assert.deepEqual(Object.keys(readRaw().accounts), ["work"]);
  assert.equal(readRaw().active_account, "work");
});

test("an invalid --account name is refused before anything runs", () => {
  const res = cli(["accounts", "--json", "--account", "../evil"]);
  assert.notEqual(res.status, 0);
});
