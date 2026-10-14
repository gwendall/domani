import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-tld-kind-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { tlds, tldsQuery, kindLabel } = await import("../commands/tlds.js");
const { search, notInPublicDns, notInPublicDnsReason } = await import("../commands/search.js");

const AIRDROP_REASON =
  "foo.airdrop does not resolve in public DNS: .airdrop is not a TLD of the DNS root zone (IANA), so a website or email on it cannot be reached. Domani does not offer it.";

describe("tlds sends the kind filter (#651)", () => {
  it("passes --kind through and leaves the default to the server", () => {
    assert.equal(new URLSearchParams(tldsQuery({ kind: "alt_root" })).get("kind"), "alt_root");
    assert.equal(new URLSearchParams(tldsQuery({})).has("kind"), false);
  });

  it("labels each kind", () => {
    assert.equal(kindLabel("tld"), "tld");
    assert.equal(kindLabel(undefined), "tld");
    assert.equal(kindLabel("second_level"), "second level");
    assert.equal(kindLabel("alt_root"), "alt root, no public DNS");
  });
});

describe("alt_root search results say why (#651)", () => {
  it("recognizes them and keeps the server's reason", () => {
    assert.equal(notInPublicDns({ tld_kind: "alt_root" }), true);
    assert.equal(notInPublicDns({ tld_kind: "tld" }), false);
    assert.equal(notInPublicDns({}), false);
    assert.equal(notInPublicDnsReason({ domain: "foo.airdrop", reason: AIRDROP_REASON }), AIRDROP_REASON);
    assert.match(notInPublicDnsReason({ domain: "foo.airdrop" }), /^foo\.airdrop does not resolve in public DNS/u);
  });
});

describe("commands against a stubbed API (#651)", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  let requested: URL[] = [];
  let printed: string[] = [];
  let respond: (url: URL) => unknown = () => ({});

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requested.push(url);
      return new Response(JSON.stringify(respond(url)), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function reset(handler: (url: URL) => unknown) {
    requested = [];
    printed = [];
    respond = handler;
  }

  // eslint-disable-next-line no-control-regex
  const plain = () => printed.join("\n").replace(/\u001b\[[0-9;]*m/gu, "");

  it("tlds --kind alt_root asks for them and warns they do not resolve", async () => {
    reset(() => ({ tlds: [{ tld: "airdrop", registration: 12.5, renewal: 12.5, kind: "alt_root" }], total: 1, offset: 0, limit: null }));
    await tlds({ kind: "alt_root" });
    assert.equal(requested[0]?.pathname, "/api/tlds");
    assert.equal(requested[0]?.searchParams.get("kind"), "alt_root");
    const out = plain();
    assert.match(out, /\.airdrop/u);
    assert.match(out, /alt root, no public DNS/u);
    assert.match(out, /do not resolve in public DNS, and Domani does not sell them/u);
  });

  it("tlds without --kind shows the kind column and no warning", async () => {
    reset(() => ({ tlds: [{ tld: "co.uk", registration: 10.75, renewal: 10.75, kind: "second_level" }, { tld: "com", registration: 11.25, renewal: 11.25, kind: "tld" }], total: 2, offset: 0, limit: null }));
    await tlds({});
    const out = plain();
    assert.match(out, /Kind/u);
    assert.match(out, /second level/u);
    assert.doesNotMatch(out, /do not resolve in public DNS/u);
  });

  it("search foo.airdrop prints the reason, never 'taken'", async () => {
    reset((url) => (url.pathname === "/api/domains/search"
      ? { domain: "foo.airdrop", available: false, price: 0, currency: "USD", tld_kind: "alt_root", reason: AIRDROP_REASON }
      : {}));
    await search("foo.airdrop", [], {});
    const out = plain();
    assert.match(out, /foo\.airdrop does not resolve in public DNS/u);
    assert.doesNotMatch(out, /taken/u);
  });
});
