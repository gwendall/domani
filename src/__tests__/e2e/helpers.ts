import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// ── Binary path ──────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../../../dist/domani.cjs");

// ── Environment ──────────────────────────────────────

/** Domain used for read and mutating tests. Must be owned by the authenticated account. */
export const TEST_DOMAIN = process.env.E2E_DOMAIN || "gwendall.dev";

/** Gate for mutating tests (DNS set/delete, token create/revoke, etc.) */
export const MUTATE_ENABLED = process.env.E2E_MUTATE === "1";

/** Default timeout for API calls (ms) */
export const API_TIMEOUT = 30_000;

// ── Types ────────────────────────────────────────────

export interface RunResult {
  data: unknown;
  stdout: string;
  exitCode: number;
}

export interface RunOptions {
  env?: Record<string, string>;
  expectError?: boolean;
  timeout?: number;
}

// ── CLI runner ───────────────────────────────────────

export function run(args: string[], options: RunOptions = {}): RunResult {
  const fullArgs = [...args];
  if (!fullArgs.includes("--json")) fullArgs.push("--json");

  const env = {
    ...process.env,
    DOMANI_API_KEY: process.env.DOMANI_API_KEY || "",
    ...options.env,
  };

  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...fullArgs], {
      encoding: "utf-8",
      timeout: options.timeout ?? API_TIMEOUT,
      killSignal: "SIGKILL",
      maxBuffer: 10 * 1024 * 1024,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let data: unknown = null;
    try { data = JSON.parse(stdout.trim()); } catch {}
    return { data, stdout: stdout.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    const stdout = String(e.stdout || "").trim();
    const exitCode = e.status ?? 1;

    if (!options.expectError) {
      assert.fail(
        `CLI exited with code ${exitCode}.\nArgs: ${fullArgs.join(" ")}\nStdout: ${stdout}\nStderr: ${String(e.stderr || "").trim()}`
      );
    }

    let data: unknown = null;
    try { data = JSON.parse(stdout); } catch {}
    return { data, stdout, exitCode };
  }
}

// ── Assertions ───────────────────────────────────────

export function assertSuccess(result: RunResult): asserts result is RunResult & { data: Record<string, unknown> } {
  assert.equal(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Output: ${result.stdout.slice(0, 500)}`);
  assert.notEqual(result.data, null, "Expected JSON output");
}

export function assertError(result: RunResult, expectedCode?: string): void {
  assert.notEqual(result.exitCode, 0, "Expected non-zero exit");
  if (expectedCode && result.data && typeof result.data === "object") {
    assert.equal((result.data as Record<string, unknown>).code, expectedCode);
  }
}

export function assertField(data: unknown, key: string, expected?: unknown): void {
  assert.ok(data && typeof data === "object", "Expected object data");
  const obj = data as Record<string, unknown>;
  assert.ok(key in obj, `Missing field "${key}" in ${JSON.stringify(Object.keys(obj))}`);
  if (expected !== undefined) assert.deepStrictEqual(obj[key], expected);
}

export function assertArray(data: unknown, key?: string): unknown[] {
  if (key) {
    assert.ok(data && typeof data === "object", "Expected object");
    const arr = (data as Record<string, unknown>)[key];
    assert.ok(Array.isArray(arr), `Expected "${key}" to be array`);
    return arr;
  }
  assert.ok(Array.isArray(data), "Expected array");
  return data;
}

export function assertDryRun(result: RunResult, action: string): Record<string, unknown> {
  assertSuccess(result);
  const data = result.data as Record<string, unknown>;
  assert.equal(data.dry_run, true, "Expected dry_run: true");
  assert.equal(data.action, action, `Expected action "${action}", got "${data.action}"`);
  return data;
}

// ── Guards ───────────────────────────────────────────
// All skip functions return true if skipped. Caller MUST return early.
// node:test t.skip() does NOT stop execution.

export function skipIfNoMutate(t: { skip: (msg: string) => void }): boolean {
  if (!MUTATE_ENABLED) { t.skip("Set E2E_MUTATE=1 to enable"); return true; }
  return false;
}

export function skipIfNoAuth(t: { skip: (msg: string) => void }): boolean {
  if (!process.env.DOMANI_API_KEY) { t.skip("No DOMANI_API_KEY"); return true; }
  return false;
}

export function testId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run without any auth (no env key, no config file).
 * Overrides HOME to a temp dir so ~/.domani/config.json is not found.
 */
export function runNoAuth(args: string[], options: RunOptions = {}): RunResult {
  return run(args, {
    ...options,
    expectError: options.expectError ?? true,
    env: {
      ...options.env,
      DOMANI_API_KEY: "",
      HOME: "/tmp/domani-e2e-noauth",
      XDG_CONFIG_HOME: "/tmp/domani-e2e-noauth",
    },
  });
}
