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

describe("buy against a stubbed API", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realExit = process.exit;
  let printed: string[] = [];
  let buyBodies: Array<Record<string, unknown>> = [];
  let respondToBuy: () => Response = () => new Response("{}");

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
      if (url.pathname === "/api/domains/buy") {
        buyBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return respondToBuy();
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

  function reset(handler: () => Response) {
    printed = [];
    buyBodies = [];
    respondToBuy = handler;
  }

  const lastJson = () => JSON.parse(printed.at(-1) ?? "{}");

  it("a bulk buy caps the charge at the total shown", async () => {
    reset(() => json({ results: [{ domain: "a.dev", success: true }, { domain: "b.dev", success: true }], summary: { succeeded: 2, failed: 0 } }));
    await buy(["a.dev", "b.dev"], { json: true });
    assert.equal(buyBodies.length, 1);
    assert.equal(buyBodies[0].max_price, 9);
  });

  it("a bulk buy refused above the ceiling fails with the price and the flag that accepts it", async () => {
    reset(() => json(refusal, 400));
    await assert.rejects(buy(["a.dev", "b.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(buyBodies.length, 1);
    const out = lastJson();
    assert.equal(out.code, "price_above_max");
    assert.equal(out.price, 12.5);
    assert.match(out.hint, /--max-price 12\.50/u);
  });

  it("--max-price replaces the ceiling", async () => {
    reset(() => json({ results: [{ domain: "a.dev", success: true }, { domain: "b.dev", success: true }], summary: { succeeded: 2, failed: 0 } }));
    await buy(["a.dev", "b.dev"], { json: true, maxPrice: "12.50" });
    assert.equal(buyBodies[0].max_price, 12.5);
  });

  it("a bulk buy that fails for another reason no longer ends silently", async () => {
    reset(() => json({ error: "Payment method required", code: "PAYMENT_REQUIRED" }, 402));
    await assert.rejects(buy(["a.dev", "b.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(lastJson().error, "Payment method required");
  });

  it("a single buy refused in the stream fails with the price to accept", async () => {
    reset(() => sse([["checking", { domain: "a.dev" }], ["error", refusal]]));
    await assert.rejects(buy(["a.dev"], { json: true }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(buyBodies[0].max_price, 4.5);
    const out = lastJson();
    assert.equal(out.code, "price_above_max");
    assert.equal(out.price, 12.5);
  });

  it("rejects a --max-price that is not a positive amount", async () => {
    reset(() => json({}));
    await assert.rejects(buy(["a.dev"], { json: true, maxPrice: "cheap" }), (err: unknown) => err instanceof Exit && err.code === 1);
    assert.equal(lastJson().code, "validation_error");
    assert.equal(parseMaxPrice(undefined, {}), undefined);
    assert.equal(parseMaxPrice("15", {}), 15);
    assert.equal(buyBodies.length, 0);
  });
});
