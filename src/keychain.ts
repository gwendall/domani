import { spawnSync } from "child_process";

/**
 * OS keychain storage for the API tokens - preferred over the plaintext
 * ~/.domani/config.json. macOS uses the login Keychain (`security`), Linux
 * uses libsecret (`secret-tool`) when installed. Everything degrades
 * gracefully to the config-file fallback when no keychain is available.
 *
 * Each saved CLI account has its own entry: service `domani-cli`, account =
 * the CLI account name. The single-session CLI stored its token under the
 * account `default`, which is exactly the entry of the `default` account, so
 * upgrading needs no keychain migration.
 */

const SERVICE = "domani-cli";

export interface KeychainBackend {
  available(): boolean;
  get(account: string): string | undefined;
  set(account: string, token: string): boolean;
  delete(account: string): void;
}

function run(cmd: string, args: string[], input?: string): { ok: boolean; stdout: string } {
  try {
    const res = spawnSync(cmd, args, {
      encoding: "utf-8",
      input,
      timeout: 3000,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return { ok: res.status === 0, stdout: (res.stdout || "").trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

const osBackend: KeychainBackend = {
  available() {
    if (process.platform === "darwin") return true;
    if (process.platform === "linux") return run("secret-tool", ["--help"]).ok;
    return false;
  },
  get(account) {
    if (process.platform === "darwin") {
      const res = run("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
      return res.ok && res.stdout ? res.stdout : undefined;
    }
    if (process.platform === "linux") {
      const res = run("secret-tool", ["lookup", "service", SERVICE, "account", account]);
      return res.ok && res.stdout ? res.stdout : undefined;
    }
    return undefined;
  },
  set(account, token) {
    if (process.platform === "darwin") {
      // -U updates in place if the item already exists.
      return run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", token]).ok;
    }
    if (process.platform === "linux") {
      return run("secret-tool", ["store", `--label=domani CLI token (${account})`, "service", SERVICE, "account", account], token + "\n").ok;
    }
    return false;
  },
  delete(account) {
    if (process.platform === "darwin") {
      run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    } else if (process.platform === "linux") {
      run("secret-tool", ["clear", "service", SERVICE, "account", account]);
    }
  },
};

let backend: KeychainBackend = osBackend;
const cache = new Map<string, string | null>();

/** Tests swap in an in-memory backend so they never touch the real keychain. */
export function setKeychainBackend(next: KeychainBackend | null): void {
  backend = next ?? osBackend;
  cache.clear();
}

export function keychainAvailable(): boolean {
  return backend.available();
}

export function keychainGet(account: string, options: { refresh?: boolean } = {}): string | undefined {
  if (!options.refresh && cache.has(account)) return cache.get(account) ?? undefined;
  const value = backend.get(account);
  cache.set(account, value ?? null);
  return value;
}

export function keychainSet(account: string, token: string): boolean {
  const ok = backend.set(account, token);
  if (ok) cache.set(account, token);
  return ok;
}

export function keychainDelete(account: string): void {
  backend.delete(account);
  cache.set(account, null);
}
