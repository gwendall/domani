import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DOMANI_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-dns-"));
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { nextDnsRecords } = await import("../commands/dns.js");

const zone = [
  { type: "A", name: "@", value: "76.76.21.21", ttl: 3600 },
  { type: "CNAME", name: "www", value: "cname.vercel-dns.com", ttl: 3600 },
  { type: "TXT", name: "@", value: "v=spf1 -all", ttl: 3600 },
];

describe("dns set and add", () => {
  it("set replaces the @ A record and keeps the rest of the zone", () => {
    const next = nextDnsRecords(zone, { type: "A", name: "@", value: "1.2.3.4" }, "set");
    assert.equal(next.kind, "write");
    assert.deepEqual(next.kind === "write" && next.records.filter((r) => r.type === "A").map((r) => r.value), ["1.2.3.4"]);
    assert.equal(next.kind === "write" && next.records.length, 3);
  });

  it("add keeps the existing @ A record beside the new one", () => {
    const next = nextDnsRecords(zone, { type: "A", name: "@", value: "1.2.3.4" }, "add");
    assert.deepEqual(next.kind === "write" && next.records.filter((r) => r.type === "A").map((r) => r.value), ["76.76.21.21", "1.2.3.4"]);
    assert.equal(next.kind === "write" && next.records.length, 4);
  });

  it("add of a value already there changes nothing", () => {
    assert.deepEqual(nextDnsRecords(zone, { type: "A", name: "@", value: "76.76.21.21" }, "add"), { kind: "unchanged" });
  });

  it("add refuses a second CNAME on a name", () => {
    assert.deepEqual(nextDnsRecords(zone, { type: "CNAME", name: "www", value: "other.example" }, "add"), { kind: "cname_taken" });
  });
});
