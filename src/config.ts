import fs from "fs";
import path from "path";
import os from "os";
import { APP_URL } from "./brand.js";

const CONFIG_DIR = path.join(os.homedir(), ".domani");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Allow --api-url global override
let apiUrlOverride: string | undefined;

export function setApiUrlOverride(url: string): void {
  apiUrlOverride = url;
}

const VERSION_CACHE = path.join(CONFIG_DIR, "version-check.json");
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24h

interface Config {
  token?: string;
  email?: string;
  api_url?: string;
}

export function getConfig(): Config {
  try {
    const data = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearConfig(): void {
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {
    // already gone
  }
}

export function getApiUrl(): string {
  return apiUrlOverride || getConfig().api_url || APP_URL;
}

export function getToken(): string | undefined {
  return process.env.DOMANI_API_KEY || getConfig().token;
}

export function requireToken(): string {
  const token = getToken();
  if (!token) {
    if (process.argv.includes("--json") || !process.stdout.isTTY) {
      console.log(JSON.stringify({
        error: "Not logged in",
        code: "auth_required",
        hint: "Run 'domani login' or set DOMANI_API_KEY environment variable",
        fix_command: "domani login",
      }, null, 2));
    } else {
      console.error("Not logged in. Run: domani login");
    }
    process.exit(1);
  }
  return token;
}

declare const __CLI_VERSION__: string;
export const CLI_VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

interface VersionInfo {
  version: string;
  min: string;
  checkedAt: number;
}

function getCachedVersion(): VersionInfo | null {
  try {
    const data = fs.readFileSync(VERSION_CACHE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function cacheVersion(info: VersionInfo): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(VERSION_CACHE, JSON.stringify(info), { mode: 0o600 });
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
