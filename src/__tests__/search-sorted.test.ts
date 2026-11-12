import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-search-sorted-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { search } = await import("../commands/search.js");
const { reasonColumn, canBackorder } = await import("../commands/search-sorted.js");

const taken = (domain: string, summary: string | null, extra: Record<string, unknown> = {}) => ({
  domain, available: false, price: 11.25, currency: "USD", tld_kind: "tld" as const,
  registration: { created: "2014-03-04T00:00:00Z", expires: "2026-11-01T00:00:00Z", status: [], drop_estimate: null, summary, ...extra },
});

// What the server answers for `sort=dropping`: ranked, each taken name with its registration.
const ranked = {
  results: [
    taken("claude.net", "Being deleted: likely free around Nov 17 (estimate)", { status: ["pending delete"], drop_estimate: { date: "2026-11-17", estimated: true } }),
    taken("claude.org", "Expired 12 days ago"),
    taken("claude.com", "Expires Mar 4, 2027"),
    { domain: "claude.io", available: false, price: 40, currency: "USD", tld_kind: "tld" as const, registration: null },
    { domain: "claude.xyz", available: true, price: 1.99, currency: "USD", tld_kind: "tld" as const },
  ],
  total: 5,
  available: 1,
};

describe("the reason column", () => {
  it("prints the server's summary, or why there is none", () => {
    assert.equal(reasonColumn(ranked.results[0]), "Being deleted: likely free around Nov 17 (estimate)");
    assert.equal(reasonColumn(ranked.results[3]), "the registry did not answer");
    assert.equal(reasonColumn({ domain: "a.com", available: false, price: 1, currency: "USD" }), "not looked up (over the 50 names per request)");
  });

  it("offers to follow only names lapsing or being deleted", () => {
    assert.equal(canBackorder(ranked.results[0]), true);
    assert.equal(canBackorder(ranked.results[1]), true);
    assert.equal(canBackorder(ranked.results[2]), false);
  });
});

describe("search --sort against a stubbed API", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  let printed: string[] = [];
  let asked: URL[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      asked.push(url);
      if (url.pathname === "/api/tlds") return json({ tlds: [{ tld: "com" }, { tld: "net" }, { tld: "org" }, { tld: "io" }, { tld: "xyz" }] });
      return json(ranked);
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  // eslint-disable-next-line no-control-regex
  const plain = () => printed.join("\n").replace(/\u001b\[[0-9;]*m/gu, "");

  it("asks the server to rank, then prints the taken names in its order with their reason", async () => {
    printed = []; asked = [];
    await search("claude", [], { sort: "dropping" });
    const request = asked.find((url) => url.pathname === "/api/domains/search");
    assert.equal(request?.searchParams.get("sort"), "dropping");
    assert.equal(request?.searchParams.get("domains")?.split(",")[0], "claude.com");
    const out = plain();
    assert.match(out, /claude\.net\s+Being deleted: likely free around Nov 17 \(estimate\)/u);
    assert.match(out, /claude\.org\s+Expired 12 days ago/u);
    assert.match(out, /claude\.io\s+the registry did not answer/u);
    assert.ok(out.indexOf("claude.net") < out.indexOf("claude.org") && out.indexOf("claude.org") < out.indexOf("claude.xyz"));
    assert.match(out, /domani follow claude\.net/u);
  });

  it("keeps the API's fields with --json", async () => {
    printed = [];
    await search("claude", ["net", "org"], { sort: "newest", json: true });
    const out = JSON.parse(printed.at(-1) ?? "{}");
    assert.equal(out.sort, "newest");
    assert.equal(out.results[0].registration.summary, "Being deleted: likely free around Nov 17 (estimate)");
  });
});
