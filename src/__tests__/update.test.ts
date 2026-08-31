import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setApiUrlOverride } from "../config.js";
import { update } from "../commands/update.js";

// Regression scope: non-TTY runs are auto-switched to JSON mode by the
// preAction hook, and JSON mode used to answer `hint: "Run 'domani update'
// to upgrade."` - circular advice for the very caller that just ran it.
// JSON mode stays check-only (scripts rely on `--json` never replacing the
// binary), but `--yes` now performs the update and the hint names it.

const NEW_BUNDLE = "#!/usr/bin/env node\nconsole.log('new version');\n";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let binPath: string;
let originalArgv1: string | undefined;
let logs: string[];
let originalLog: typeof console.log;

beforeEach(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/api/cli/version") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        version: "9.9.9",
        min: "0.0.0",
        sha256: createHash("sha256").update(NEW_BUNDLE).digest("hex"),
      }));
      return;
    }
    if (req.url === "/cli/domani.js") {
      res.end(NEW_BUNDLE);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
  setApiUrlOverride(baseUrl);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-update-test-"));
  binPath = path.join(tmpDir, "domani");
  fs.writeFileSync(binPath, "old version", { mode: 0o755 });
  originalArgv1 = process.argv[1];
  process.argv[1] = binPath;

  logs = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
});

afterEach(async () => {
  console.log = originalLog;
  if (originalArgv1 !== undefined) process.argv[1] = originalArgv1;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("json mode without --yes stays check-only and hints at --yes", async () => {
  await update({ json: true });

  assert.equal(fs.readFileSync(binPath, "utf8"), "old version", "binary must not be replaced in check-only mode");
  const out = JSON.parse(logs.join("\n"));
  assert.equal(out.up_to_date, false);
  assert.equal(out.latest, "9.9.9");
  assert.match(out.hint, /--yes/, "hint must name a command that actually updates in non-TTY mode");
});

test("json mode with --yes performs the update and reports it", async () => {
  await update({ json: true, yes: true });

  assert.equal(fs.readFileSync(binPath, "utf8"), NEW_BUNDLE, "binary must be replaced");
  assert.equal((fs.statSync(binPath).mode & 0o777), 0o755);
  const out = JSON.parse(logs.join("\n"));
  assert.equal(out.updated, true);
  assert.equal(out.to, "9.9.9");
});
