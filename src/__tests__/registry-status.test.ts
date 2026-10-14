import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-registry-status-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { search, heldByRegistry, registryLabel, registryReason, dropResult } = await import("../commands/search.js");
const { suggest } = await import("../commands/suggest.js");

const PREMIUM_REASON = "feedback.xyz is a premium name: the registry prices it at $1250.20. Premium names cannot be bought at the standard price.";
const premium = { domain: "feedback.xyz", available: false, price: 4.04, currency: "USD", tld_kind: "tld", registry_status: "premium" as const, registry_price: 1250.2, reason: PREMIUM_REASON };

describe("registry premium and reserved results", () => {
  it("recognizes them and labels them with the price when known", () => {
    assert.equal(heldByRegistry({ registry_status: "premium" }), true);
    assert.equal(heldByRegistry({ registry_status: "reserved" }), true);
    assert.equal(heldByRegistry({}), false);
    assert.equal(registryLabel({ registry_status: "premium", registry_price: 1250.2 }), "premium $1250.20");
    assert.equal(registryLabel({ registry_status: "premium" }), "premium");
    assert.equal(registryLabel({ registry_status: "reserved" }), "reserved");
  });

  it("keeps the server's reason, and says the same when an older server sent none", () => {
    assert.equal(registryReason(premium), PREMIUM_REASON);
    assert.equal(registryReason({ domain: "feedback.xyz", registry_status: "premium", registry_price: 1250.2 }), PREMIUM_REASON);
    assert.match(registryReason({ domain: "hf.bot", registry_status: "premium" }), /^hf\.bot is a premium name priced by the registry\./u);
    assert.equal(registryReason({ domain: "reverse.engineer", registry_status: "reserved" }), "reverse.engineer is reserved by the registry and cannot be registered.");
  });

  it("drops the earlier answer for a corrected name", () => {
    const list = [{ domain: "a.com" }, { domain: "feedback.xyz" }];
    assert.equal(dropResult(list, "feedback.xyz"), 1);
    assert.deepEqual(list, [{ domain: "a.com" }]);
    assert.equal(dropResult(list, "feedback.xyz"), -1);
  });
});

describe("commands against a stubbed API", () => {
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
  const tlds = () => json({ tlds: [{ tld: "xyz" }, { tld: "com" }, { tld: "io" }], total: 3, offset: 0, limit: null });

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
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  it("search feedback.xyz prints the premium reason, never 'taken'", async () => {
    reset((url) => (url.pathname === "/api/domains/search" ? json(premium) : json({})));
    await search("feedback.xyz", [], {});
    const out = plain();
    assert.match(out, /feedback\.xyz is a premium name: the registry prices it at \$1250\.20/u);
    assert.doesNotMatch(out, /taken/u);
  });

  it("search reverse.engineer says it is reserved, even without a reason from the server", async () => {
    reset((url) => (url.pathname === "/api/domains/search"
      ? json({ domain: "reverse.engineer", available: false, price: 47, currency: "USD", tld_kind: "tld", registry_status: "reserved" })
      : json({})));
    await search("reverse.engineer", [], {});
    const out = plain();
    assert.match(out, /reverse\.engineer is reserved by the registry and cannot be registered\./u);
    assert.doesNotMatch(out, /taken/u);
  });

  // The server streams feedback.xyz as available (RDAP), then corrects it once the registry answered.
  const stream = () => sse([
    ["result", { domain: "feedback.com", available: false, price: 11.25, currency: "USD", tld_kind: "tld" }],
    ["result", { domain: "feedback.io", available: true, price: 35, currency: "USD", tld_kind: "tld" }],
    ["result", { domain: "feedback.xyz", available: true, price: 4.04, currency: "USD", tld_kind: "tld" }],
    ["result", premium],
    ["result", { domain: "feedback.io", available: false, price: 35, currency: "USD", tld_kind: "tld" }],
    ["done", { total: 3, available: 0 }],
  ]);

  it("search --tlds shows a corrected premium once, with its price, and drops an RDAP false positive", async () => {
    reset((url) => (url.pathname === "/api/tlds" ? tlds() : stream()));
    await search("feedback", ["xyz", "com", "io"], {});
    const out = plain();
    assert.match(out, /feedback\.xyz\s+premium \$1250\.20/u);
    assert.match(out, /feedback\.xyz is a premium name/u);
    assert.doesNotMatch(out, /\$4\.04/u);
    assert.doesNotMatch(out, /feedback\.(io|com)/u);
    assert.match(out, /Checked 3 TLDs · 0 available/u);
  });

  it("search --json keeps the latest answer per domain", async () => {
    reset((url) => (url.pathname === "/api/tlds" ? tlds() : stream()));
    await search("feedback", ["xyz", "com", "io"], { json: true });
    const out = JSON.parse(printed.at(-1) ?? "{}");
    assert.equal(out.available, 0);
    assert.deepEqual(out.results.map((r: { domain: string }) => r.domain), ["feedback.xyz"]);
    assert.equal(out.results[0].available, false);
    assert.equal(out.results[0].registry_status, "premium");
    assert.equal(out.results[0].registry_price, 1250.2);
  });

  it("suggest lists a corrected premium once, as premium", async () => {
    reset(() => sse([
      ["result", { domain: "codebuddy.dev", available: true, price: 13, currency: "USD" }],
      ["result", { domain: "feedback.xyz", available: true, price: 4.04, currency: "USD" }],
      ["result", { domain: "feedback.xyz", available: false, price: 4.04, currency: "USD", registry_status: "premium", registry_price: 1250.2 }],
      ["done", { total: 1, checked: 2, iterations: 1 }],
    ]));
    await suggest("feedback tool", {});
    const out = plain();
    assert.equal(count(out, "feedback.xyz"), 1);
    assert.match(out, /feedback\.xyz\s+premium \$1250\.20/u);
    assert.match(out, /codebuddy\.dev/u);
    assert.doesNotMatch(out, /domani buy feedback\.xyz/u);
  });
});
