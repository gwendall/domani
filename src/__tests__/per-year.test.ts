import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-per-year-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { perYear, renewalDiffers } = await import("../per-year.js");
const { search } = await import("../commands/search.js");
const { suggest } = await import("../commands/suggest.js");
const { buy } = await import("../commands/buy.js");

describe("the price of the first year and of the years after", () => {
  it("says per year when every year costs the same, or when the renewal is unknown", () => {
    assert.equal(perYear(14.5), "$14.50/yr");
    assert.equal(perYear(14.5, 14.5), "$14.50/yr");
  });

  it("states both when the first year is sold below the renewal", () => {
    assert.equal(perYear(69, 107), "$69.00 first year, then $107.00/yr");
  });

  it("compares in cents, so a sum of floats is not a difference", () => {
    assert.equal(renewalDiffers(0.1 + 0.2, 0.3), false);
    assert.equal(perYear(0.1 + 0.2, 0.3), "$0.30/yr");
  });
});

describe("commands state the renewal beside the first-year price", () => {
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
  const whackedGg = { domain: "whacked.gg", available: true, price: 69, renewal_price: 107, currency: "USD", tld_kind: "tld" };
  const whackedCom = { domain: "whacked.com", available: true, price: 14.5, renewal_price: 14.5, currency: "USD", tld_kind: "tld" };

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
  const lineOf = (text: string, domain: string) => text.split("\n").find((l) => l.includes(domain)) ?? "";

  it("search --tlds shows the renewal only where it differs", async () => {
    reset((url) => (url.pathname === "/api/tlds"
      ? json({ tlds: [{ tld: "gg" }, { tld: "com" }], total: 2, offset: 0, limit: null })
      : sse([["result", whackedGg], ["result", whackedCom], ["done", { total: 2, available: 2 }]])));
    await search("whacked", ["gg", "com"], {});
    const out = plain();
    assert.match(lineOf(out, "whacked.gg"), /\$69\.00 first year, then \$107\.00\/yr/u);
    assert.match(lineOf(out, "whacked.com"), /\$14\.50\/yr/u);
    assert.doesNotMatch(lineOf(out, "whacked.com"), /first year/u);
  });

  it("suggest shows the renewal when it differs", async () => {
    reset(() => sse([["result", whackedGg], ["done", { total: 1, checked: 1, iterations: 1 }]]));
    await suggest("whacked games", {});
    assert.match(lineOf(plain(), "whacked.gg"), /\$69\.00 first year, then \$107\.00\/yr/u);
  });

  it("a buy dry run states what each later year costs", async () => {
    reset((url) => (url.pathname === "/api/domains/search" ? json(whackedGg) : json({})));
    await buy(["whacked.gg"], { json: true, dryRun: true });
    const out = JSON.parse(printed.at(-1) ?? "{}");
    assert.equal(out.price, 69);
    assert.equal(out.renewal_price, 107);
  });

  it("a bulk dry run states the renewal of each name", async () => {
    reset((url) => (url.pathname === "/api/domains/search"
      ? json(url.searchParams.get("q") === "whacked.gg" ? whackedGg : whackedCom)
      : json({})));
    await buy(["whacked.gg", "whacked.com"], { json: true, dryRun: true });
    const out = JSON.parse(printed.at(-1) ?? "{}");
    assert.deepEqual(out.domains, [
      { domain: "whacked.gg", price: 69, renewal_price: 107 },
      { domain: "whacked.com", price: 14.5, renewal_price: 14.5 },
    ]);
  });
});
