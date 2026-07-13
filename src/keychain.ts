import { spawnSync } from "child_process";

/**
 * OS keychain storage for the API token - preferred over the plaintext
 * ~/.domani/config.json. macOS uses the login Keychain (`security`), Linux
 * uses libsecret (`secret-tool`) when installed. Everything degrades
 * gracefully to the config-file fallback when no keychain is available.
 */

const SERVICE = "domani-cli";
const ACCOUNT = "default";

let cached: string | null | undefined; // undefined = not looked up yet

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

export function keychainAvailable(): boolean {
  if (process.platform === "darwin") return true;
  if (process.platform === "linux") return run("secret-tool", ["--help"]).ok;
  return false;
}

export function keychainGet(): string | undefined {
  if (cached !== undefined) return cached ?? undefined;
  let value: string | undefined;
  if (process.platform === "darwin") {
    const res = run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
    if (res.ok && res.stdout) value = res.stdout;
  } else if (process.platform === "linux") {
    const res = run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
    if (res.ok && res.stdout) value = res.stdout;
  }
  cached = value ?? null;
  return value;
}

export function keychainSet(token: string): boolean {
  let ok = false;
  if (process.platform === "darwin") {
    // -U updates in place if the item already exists.
    ok = run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", token]).ok;
  } else if (process.platform === "linux") {
    ok = run("secret-tool", ["store", "--label=domani CLI token", "service", SERVICE, "account", ACCOUNT], token + "\n").ok;
  }
  if (ok) cached = token;
  return ok;
}

export function keychainDelete(): void {
  if (process.platform === "darwin") {
    run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
  } else if (process.platform === "linux") {
    run("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
  }
  cached = null;
}
