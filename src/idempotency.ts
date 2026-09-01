import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = process.env.DOMANI_CONFIG_DIR || path.join(os.homedir(), ".domani");
const MUTATION_DIR = path.join(CONFIG_DIR, "mutations");

function receiptPath(operation: string): string {
  return path.join(MUTATION_DIR, `${crypto.createHash("sha256").update(operation).digest("hex")}.json`);
}

export function persistentIdempotencyKey(operation: string, request: unknown, supplied?: string): { key: string; complete: () => void } {
  const file = receiptPath(operation);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
  if (!supplied) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, "utf8")) as { key?: string; fingerprint?: string };
      if (existing.key && existing.fingerprint === fingerprint) {
        return { key: existing.key, complete: () => { try { fs.unlinkSync(file); } catch {} } };
      }
    } catch {}
  }
  const key = supplied || `cli-${crypto.randomUUID()}`;
  fs.mkdirSync(MUTATION_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ key, fingerprint }), { mode: 0o600 });
  return { key, complete: () => { try { fs.unlinkSync(file); } catch {} } };
}
