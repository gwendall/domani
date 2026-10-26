import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-max-price-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { acceptPriceHint, parseMaxPrice, priceToAccept, roundToCent } = await import("../max-price.js");
const { buy } = await import("../commands/buy.js");
const { renew } = await import("../commands/renew.js");

class Exit extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("max-price helpers", () => {
  it("rounds a total to the cent the server compares", () => {
    assert.equal(roundToCent(1.1 * 3), 3.3);
    assert.equal(roundToCent(12.499), 12.5);
  });

  it("reads the total to accept only from a PRICE_ABOVE_MAX refusal with a price", () => {
    assert.equal(priceToAccept({ code: "PRICE_ABOVE_MAX", price: 12.5 }), 12.5);
    assert.equal(priceToAccept({ code: "PRICE_ABOVE_MAX" }), undefined);
    assert.equal(priceToAccept({ code: "PRICE_ABOVE_MAX", price: "12.5" }), undefined);
    assert.equal(priceToAccept({ code: "PAYMENT_REQUIRED", price: 12.5 }), undefined);
  });

  it("names the flag that accepts the new price", () => {
    assert.equal(acceptPriceHint(12.5), "Nothing was charged. Re-run with --max-price 12.50 to accept the new price.");
  });
});

describe("buy and renew against a stubbed API", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realExit = process.exit;
  let printed: string[] = [];
  let postedBodies: Array<Record<string, unknown>> = [];
  let respondToPost: () => Response = () => new Response("{}");
  let renewalPrice: number | null = 51.8;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const sse = (events: Array<[string, unknown]>) =>
    new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const refusal = { error: "The total is $12.50, above your max_price of $9.00. Nothing was charged.", code: "PRICE_ABOVE_MAX", price: 12.5 };

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/api/domains/search") {
        return json({ domain: url.searchParams.get("q"), available: true, price: 4.5, currency: "USD" });
      }
      if (url.pathname === "/api/domains/buy" || url.pathname === "/api/domains/a.dev/renew") {
        postedBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return respondToPost();
      }
      if (url.pathname === "/api/domains/a.dev") {
        return json({ domain: "a.dev", renewal_price: renewalPrice });
      }
      return json({});
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
    process.exit = ((code?: number | string | null) => { throw new Exit(code); }) as typeof process.exit;
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    process.exit = realExit;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function reset(handler: () => Response, yearly: number | null = 51.8) {
    printed = [];
    postedBodies = [];
    respondToPost = handler;
    renewalPrice = yearly;
  }

  const lastJson = () => JSON.parse(printed.at(-1) ?? "{}");

  it("a bulk buy caps the charge at the total shown", async () => {
    reset(() => json({ results: [{ domain: "a.dev", success: true }, { domain: "b.dev", success: true }], summary: { succeeded: 2, failed: 0 } }));
    await buy(["a.dev", "b.dev"], { json: true });
    assert.equal(postedBodies.length, 1);
    assert.equal(postedBodies[0].max_price, 9);
  });

  it("a bulk buy refused above the ceiling fails with the price and the flag that accepts it", async () => {
    reset(() => json(refusal, 400));
    await assert.rejects(buy(["a.dev", "b.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(postedBodies.length, 1);
    const out = lastJson();
    assert.equal(out.code, "price_above_max");
    assert.equal(out.price, 12.5);
    assert.match(out.hint, /--max-price 12\.50/u);
  });

  it("--max-price replaces the ceiling", async () => {
    reset(() => json({ results: [{ domain: "a.dev", success: true }, { domain: "b.dev", success: true }], summary: { succeeded: 2, failed: 0 } }));
    await buy(["a.dev", "b.dev"], { json: true, maxPrice: "12.50" });
    assert.equal(postedBodies[0].max_price, 12.5);
  });

  it("a bulk buy that fails for another reason no longer ends silently", async () => {
    reset(() => json({ error: "Payment method required", code: "PAYMENT_REQUIRED" }, 402));
    await assert.rejects(buy(["a.dev", "b.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(lastJson().error, "Payment method required");
  });

  it("a single buy refused in the stream fails with the price to accept", async () => {
    reset(() => sse([["checking", { domain: "a.dev" }], ["error", refusal]]));
    await assert.rejects(buy(["a.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(postedBodies[0].max_price, 4.5);
    const out = lastJson();
    assert.equal(out.code, "price_above_max");
    assert.equal(out.price, 12.5);
  });

  it("a single buy whose registrar changed carries the new price, the listed one and the renewal", async () => {
    // kiku.sh, 2026-10-16: the registrar with the listed price could not take it.
    const changed = { error: "a.dev costs $77.00 (renews at $77.00/year), above the $4.50 listed.", code: "PRICE_ABOVE_MAX", price: 77, listed_price: 4.5, renewal_price: 77 };
    reset(() => sse([["checking", { domain: "a.dev" }], ["error", changed]]));
    await assert.rejects(buy(["a.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    const out = lastJson();
    assert.equal(out.code, "price_above_max");
    assert.equal(out.price, 77);
    assert.equal(out.listed_price, 4.5);
    assert.equal(out.renewal_price, 77);
    assert.match(out.hint, /--max-price 77\.00/u);
  });

  const renewed = { domain: "a.dev", renewed_years: 3, new_expiry: "2029-10-14T00:00:00.000Z", price: 155.4, currency: "USD" };

  it("a renewal caps the charge at the yearly price times the years", async () => {
    reset(() => json(renewed));
    await renew("a.dev", { years: "3", json: true });
    assert.deepEqual(postedBodies, [{ years: 3, max_price: 155.4 }]);
  });

  it("a renewal refused above the ceiling fails with the price and the flag that accepts it", async () => {
    reset(() => json(refusal, 400));
    await assert.rejects(renew("a.dev", { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(postedBodies.length, 1);
    const out = lastJson();
    assert.equal(out.code, "price_above_max");
    assert.equal(out.price, 12.5);
    assert.match(out.hint, /--max-price 12\.50/u);
  });

  it("--max-price replaces the renewal ceiling", async () => {
    reset(() => json(renewed));
    await renew("a.dev", { years: "3", json: true, maxPrice: "160" });
    assert.equal(postedBodies[0].max_price, 160);
  });

  it("a renewal without a known price leaves the ceiling to the server", async () => {
    reset(() => json(renewed), null);
    await renew("a.dev", { json: true });
    assert.deepEqual(postedBodies, [{ years: 1 }]);
  });

  it("a renewal dry run states the total and charges nothing", async () => {
    reset(() => json(renewed));
    await renew("a.dev", { years: "3", json: true, dryRun: true });
    assert.equal(postedBodies.length, 0);
    assert.deepEqual(lastJson(), { dry_run: true, action: "renew", domain: "a.dev", years: 3, price: 155.4, currency: "USD", max_price: 155.4, acting_as: "DOMANI_API_KEY" });
  });

  it("rejects a --max-price that is not a positive amount", async () => {
    reset(() => json({}));
    await assert.rejects(buy(["a.dev"], { json: true, maxPrice: "cheap" }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(lastJson().code, "validation_error");
    assert.equal(parseMaxPrice(undefined, {}), undefined);
    assert.equal(parseMaxPrice("15", {}), 15);
    assert.equal(postedBodies.length, 0);
  });
});
