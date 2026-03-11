import pc from "picocolors";
import { execFile } from "child_process";

// ── TTY auto-detect ──────────────────────────────────
// When stdout is not a TTY (piped to another program or agent),
// automatically switch to JSON output. This lets agents pipe
// `domani list` without needing `--json`.

/** True when stdout is an interactive terminal */
export const isTTY = process.stdout.isTTY ?? false;

/** Resolve whether output should be JSON: explicit --json flag OR non-TTY stdout */
export function isJsonOutput(options: { json?: boolean }): boolean {
  return !!(options.json || !isTTY);
}

// ── Symbols ────────────────────────────────────────────
export const S = {
  success: pc.green("✓"),
  error: pc.red("✗"),
  warning: pc.yellow("!"),
  info: pc.cyan("●"),
  arrow: pc.dim("→"),
  dot: pc.dim("·"),
  dash: pc.dim("─"),
};

// ── Text helpers ───────────────────────────────────────
export const fmt = {
  domain: (d: string) => pc.bold(pc.white(d)),
  price: (p: number | string) => pc.green(`$${p}`),
  label: (l: string) => pc.dim(l),
  value: (v: string) => pc.white(v),
  dim: (v: string) => pc.dim(v),
  bold: (v: string) => pc.bold(v),
  success: (v: string) => pc.green(v),
  error: (v: string) => pc.red(v),
  warn: (v: string) => pc.yellow(v),
  cyan: (v: string) => pc.cyan(v),
  url: (v: string) => `\x1b]8;;${v}\x1b\\${pc.underline(pc.cyan(v))}\x1b]8;;\x1b\\`,
};

// ── Layout helpers ─────────────────────────────────────
export function heading(title: string, width = 50): void {
  console.log();
  console.log(`  ${pc.bold(title)}`);
  console.log(`  ${pc.dim("─".repeat(width))}`);
}

export function row(label: string, value: string, indent = 2): void {
  const pad = " ".repeat(indent);
  console.log(`${pad}${pc.dim(label.padEnd(16))} ${value}`);
}

export function blank(): void {
  console.log();
}

export function hint(text: string): void {
  console.log(`  ${pc.dim(text)}`);
}

export function hintCommand(label: string, command: string): void {
  console.log(`  ${pc.dim(label)} ${pc.cyan(command)}`);
}

function formatHint(text: string): string {
  // Split on URLs, dim the text parts, make URLs clickable (OSC 8 hyperlinks)
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts
    .map((part) => {
      if (/^https?:\/\//.test(part)) {
        return `\x1b]8;;${part}\x1b\\${pc.underline(pc.cyan(part))}\x1b]8;;\x1b\\`;
      }
      return pc.dim(part);
    })
    .join("");
}

export function errorMessage(msg: string, hint?: string): void {
  console.error(`  ${S.error} ${pc.red(msg)}`);
  if (hint) console.error(`    ${formatHint(hint)}`);
}

// ── Spinner ───────────────────────────────────────────
// Returns a no-op spinner when disabled (e.g. --json mode)
// so commands don't pollute structured output with ANSI codes.
import { spinner } from "@clack/prompts";

type Spinner = ReturnType<typeof spinner>;
const noop: Spinner = { start: () => {}, stop: () => {}, message: () => {} } as Spinner;

export function createSpinner(enabled = true): Spinner {
  return enabled ? spinner() : noop;
}

// ── Table ──────────────────────────────────────────────

const ANSI_RE = /\x1b\]8;;[^\x1b]*\x1b\\|\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function padCell(cell: string, width: number): string {
  const visible = stripAnsi(cell).length;
  const pad = Math.max(0, width - visible);
  return cell + " ".repeat(pad);
}

export function table(
  headers: string[],
  rows: string[][],
  widths?: number[]
): void {
  const w = widths || headers.map((h, i) => {
    const maxRow = rows.reduce((max, r) => Math.max(max, stripAnsi(r[i] || "").length), 0);
    return Math.max(h.length, maxRow) + 2;
  });

  const headerLine = headers.map((h, i) => pc.dim(h.padEnd(w[i]))).join(" ");
  const divider = w.map((width) => pc.dim("─".repeat(width))).join(" ");

  console.log(`  ${headerLine}`);
  console.log(`  ${divider}`);
  for (const r of rows) {
    const line = r.map((cell, i) => padCell(cell, w[i])).join(" ");
    console.log(`  ${line}`);
  }
}

// ── Key normalization ────────────────────────────────
// Normalize API camelCase keys to snake_case for consistent CLI output.

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Recursively convert all object keys from camelCase to snake_case */
export function snakeKeys(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(snakeKeys);
  if (data && typeof data === "object" && !(data instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[camelToSnake(key)] = snakeKeys(value);
    }
    return result;
  }
  return data;
}

// ── JSON output ──────────────────────────────────────
// Centralized JSON output with optional field filtering.

export function jsonOut(data: unknown, fields?: string): void {
  const normalized = snakeKeys(data);
  if (!fields) {
    console.log(JSON.stringify(normalized, null, 2));
    return;
  }
  const keys = fields.split(",").map((f) => f.trim()).filter(Boolean);
  if (Array.isArray(normalized)) {
    const filtered = normalized.map((item) => pick(item as Record<string, unknown>, keys));
    console.log(JSON.stringify(filtered, null, 2));
  } else if (normalized && typeof normalized === "object") {
    console.log(JSON.stringify(pick(normalized as Record<string, unknown>, keys), null, 2));
  } else {
    console.log(JSON.stringify(normalized, null, 2));
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  // If no top-level keys matched, apply filter to array values inside the object.
  // This lets `--fields type,value` filter elements of `records: [...]`.
  if (Object.keys(result).length === 0) {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
        const filtered = value.map((item: Record<string, unknown>) => {
          const picked: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in item) picked[k] = item[k];
          }
          return picked;
        });
        if (Object.keys(filtered[0]).length > 0) result[key] = filtered;
      }
    }
  }
  return result;
}

/** Returns true if confirmation should be skipped (--yes, --json, or non-TTY implies --yes) */
export function skipConfirm(options: { yes?: boolean; json?: boolean }): boolean {
  return !!(options.yes || isJsonOutput(options));
}

// ── Dry-run output ──────────────────────────────────
// Shows what a command *would* do without executing it.

export function dryRunOut(
  action: string,
  params: Record<string, unknown>,
  json?: boolean,
  fields?: string,
): void {
  if (json) {
    jsonOut({ dry_run: true, action, ...params }, fields);
    return;
  }
  console.log();
  console.log(`  ${pc.yellow("▸ DRY RUN")} ${pc.dim("- no changes made")}`);
  console.log(`  ${pc.dim("Action:")} ${pc.bold(action)}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      console.log(`  ${pc.dim(key + ":")} ${value.map(String).join(", ")}`);
    } else if (typeof value === "object") {
      console.log(`  ${pc.dim(key + ":")} ${JSON.stringify(value)}`);
    } else {
      console.log(`  ${pc.dim(key + ":")} ${String(value)}`);
    }
  }
  console.log();
}

// ── Structured error exit ────────────────────────────
// Replaces errorMessage() + process.exit(1) with a single call.
// In --json mode: outputs structured JSON with code, hint, fix_command.
// In human mode: renders the colored error + hint as before.

interface FailOptions {
  hint?: string;
  code?: string;
  status?: number;
  fixCommand?: string;
  fixUrl?: string;
  json?: boolean;
  fields?: string;
}

const FIX_COMMANDS: Record<string, string> = {
  auth_required: "domani login",
  payment_required: "domani card add",
  contact_required: "domani contact set",
};

function inferCode(msg: string, status?: number, fixUrl?: string): string {
  if (status === 401 || status === 403) return "auth_required";
  if (status === 402 || fixUrl) return "payment_required";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation_error";
  if (status === 429) return "rate_limited";
  if (/contact/i.test(msg)) return "contact_required";
  return "error";
}

export function fail(msg: string | undefined, opts?: FailOptions): never {
  const resolvedMsg = msg || `Request failed${opts?.status ? ` (${opts.status})` : ""}`;
  const code = opts?.code || inferCode(resolvedMsg, opts?.status, opts?.fixUrl);
  const fixCommand = opts?.fixCommand || FIX_COMMANDS[code];

  if (opts?.json) {
    const out: Record<string, unknown> = { error: resolvedMsg, code };
    if (opts.hint) out.hint = opts.hint;
    if (fixCommand) out.fix_command = fixCommand;
    if (opts.fixUrl) out.fix_url = opts.fixUrl;
    jsonOut(out, opts.fields);
  } else {
    errorMessage(resolvedMsg, opts?.hint);
    if (fixCommand) {
      console.error(`    ${pc.dim("Or run:")} ${pc.cyan(fixCommand)}`);
    } else if (opts?.fixUrl) {
      console.error(`    ${formatHint(`Add a payment method at ${opts.fixUrl}`)}`);
    }
  }
  process.exit(1);
}

// ── Browser ──────────────────────────────────────────

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url]);
}

// ── Sleep ─────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Progress Table ────────────────────────────────────
// Animated table with per-row spinner → check transitions.
// Uses ANSI cursor manipulation to redraw in-place.

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface ProgressRow {
  cells: string[];
  status: "pending" | "done";
  icon?: string;
}

export function createProgressTable(
  headers: string[],
  rows: ProgressRow[],
  widths: number[],
  enabled = true
) {
  const isTTY = process.stdout.isTTY ?? false;

  if (!enabled) {
    return {
      start() {},
      markDone() {},
      stop() {},
    };
  }

  let frame = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  const lineCount = 2 + rows.length; // header + divider + data rows

  function renderLines(): string[] {
    const headerLine = "  " + headers.map((h, i) => pc.dim(h.padEnd(widths[i]))).join(" ");
    const divider = "  " + widths.map((w) => pc.dim("─".repeat(w))).join(" ");
    const result = [headerLine, divider];
    for (const row of rows) {
      const icon =
        row.status === "done"
          ? (row.icon ?? S.success)
          : pc.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
      const cells = row.cells.map((cell, i) => padCell(cell, widths[i])).join(" ");
      result.push(`  ${icon} ${cells}`);
    }
    return result;
  }

  let drawn = false;
  const restoreCursor = () => process.stdout.write("\x1b[?25h");

  function draw() {
    const lines = renderLines();
    if (drawn && isTTY) {
      process.stdout.write(`\x1b[${lineCount}A`);
      for (const line of lines) process.stdout.write(`\x1b[2K${line}\n`);
    } else {
      for (const line of lines) console.log(line);
      drawn = true;
    }
  }

  return {
    start() {
      if (isTTY) {
        process.stdout.write("\x1b[?25l"); // Hide cursor
        process.on("exit", restoreCursor);
      }
      draw();
      if (isTTY) {
        interval = setInterval(() => {
          frame++;
          draw();
        }, 80);
      }
    },

    markDone(index: number, icon?: string) {
      rows[index].status = "done";
      if (icon !== undefined) rows[index].icon = icon;
      if (isTTY) draw();
    },

    stop() {
      if (interval) clearInterval(interval);
      for (const row of rows) row.status = "done";
      draw();
      if (isTTY) {
        process.stdout.write("\x1b[?25h"); // Show cursor
        process.removeListener("exit", restoreCursor);
      }
    },
  };
}
