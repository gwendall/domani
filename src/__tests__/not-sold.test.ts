import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-not-sold-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { search, notSold } = await import("../commands/search.js");

const CN_REASON = ".cn is not sold on Domani: none of our registrars offers this extension.";
// What the server answers for a name under an extension Domani does not sell (#1364).
const cn = { domain: "gwendall-test.cn", available: false, price: 0, currency: "USD", tld_kind: "tld" as const, reason: CN_REASON };

describe("results for an extension Domani does not sell", () => {
  it("recognizes them, and only them", () => {
    assert.equal(notSold(cn), true);
    assert.equal(notSold({ ...cn, tld_kind: "second_level" }), true);
    assert.equal(notSold({ available: false, price: 11.25, tld_kind: "tld" }), false);
    assert.equal(notSold({ available: false, price: 0 }), false);
    assert.equal(notSold({ ...cn, tld_kind: "alt_root" }), false);
    assert.equal(notSold({ ...cn, registry_status: "reserved" }), false);
    assert.equal(notSold({ ...cn, error: true }), false);
  });
});

describe("search against a stubbed API (gwendall-test.cn read as taken, 2026-11-04)", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  let printed: string[] = [];
  let respond: (url: URL) => Response = () => new Response("{}");

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const sse = (events: Array<[string, unknown]>) =>
    new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const stream = () => sse([
    ["result", cn],
    ["result", { domain: "gwendall-test.com", available: false, price: 11.25, currency: "USD", tld_kind: "tld" }],
    ["done", { total: 2, available: 0 }],
  ]);

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return respond(url);
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function reset(handler: (url: URL) => Response) {
    printed = [];
    respond = handler;
  }

  // eslint-disable-next-line no-control-regex
  const plain = () => printed.join("\n").replace(/\u001b\[[0-9;]*m/gu, "");

  it("search gwendall-test.cn prints the reason, never 'taken'", async () => {
    reset((url) => (url.pathname === "/api/domains/search" ? json(cn) : json({})));
    await search("gwendall-test.cn", [], {});
    const out = plain();
    assert.match(out, /\.cn is not sold on Domani: none of our registrars offers this extension\./u);
    assert.doesNotMatch(out, /taken/u);
  });

  it("search gwendall-test.cn --json keeps the API's fields", async () => {
    reset((url) => (url.pathname === "/api/domains/search" ? json(cn) : json({})));
    await search("gwendall-test.cn", [], { json: true });
    assert.deepEqual(JSON.parse(printed.at(-1) ?? "{}"), { name: "gwendall-test", results: [cn], total: 1, available: 0 });
  });

  it("search --tlds shows the name with its label and reason, never as taken or dropped", async () => {
    reset(() => stream());
    await search("gwendall-test", ["cn", "com"], {});
    const out = plain();
    assert.match(out, /gwendall-test\.cn\s+not sold on Domani/u);
    assert.match(out, /\.cn is not sold on Domani: none of our registrars/u);
    assert.doesNotMatch(out, /taken/u);
  });

  it("search --tlds --json keeps the not-sold answer with the API's fields", async () => {
    reset(() => stream());
    await search("gwendall-test", ["cn", "com"], { json: true });
    const out = JSON.parse(printed.at(-1) ?? "{}");
    assert.deepEqual(out.results, [cn]);
    assert.equal(out.total, 2);
    assert.equal(out.available, 0);
  });
});
