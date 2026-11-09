import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-term-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const term = await import("../term.js");
const { buy } = await import("../commands/buy.js");
const { search } = await import("../commands/search.js");

// doobeedoo.ai, 2026-11-09: .ai is registered for 2 years at least.
const ai = { domain: "doobeedoo.ai", available: true, price: 84.7, renewal_price: 84.7, min_years: 2, min_term_price: 169.4, currency: "USD", tld_kind: "tld" };
const com = { domain: "doobeedoo.com", available: true, price: 14.5, renewal_price: 14.5, currency: "USD", tld_kind: "tld" };

describe("the term a buy registers and its total", () => {
  it("takes the TLD's minimum when no years are asked, at the minimum term's total", () => {
    assert.deepEqual(term.termOf(ai), { years: 2, min_years: 2, total: 169.4 });
    assert.deepEqual(term.termOf(com), { years: 1, min_years: 1, total: 14.5 });
  });

  it("bills a longer term at the yearly price times the years, rounded to the cent", () => {
    assert.deepEqual(term.termOf(ai, 3), { years: 3, min_years: 2, total: 254.1 });
    assert.deepEqual(term.termOf(com, 2), { years: 2, min_years: 1, total: 29 });
    assert.equal(term.termOf({ price: 0.1 }, 3).total, 0.3);
  });

  it("has no total without a price, and ignores a min_years of 1 or less", () => {
    assert.deepEqual(term.termOf({}), { years: 1, min_years: 1 });
    assert.equal(term.minYearsOf({ min_years: 1 }), 1);
    assert.equal(term.minYearsOf({ min_years: 2.5 }), 1);
  });

  it("states the years, the total and the minimum", () => {
    assert.equal(term.termPrice(ai), "$169.40 for 2 years (2-year minimum), then $84.70/yr");
    assert.equal(term.termPrice(ai, term.termOf(ai, 3)), "$254.10 for 3 years, then $84.70/yr");
    assert.equal(term.termPrice(com), "$14.50/yr");
    assert.equal(term.termPrice({ price: 69, renewal_price: 107 }), "$69.00 first year, then $107.00/yr");
    assert.equal(term.termPhrase(ai, term.termOf(ai)), "for 2 years: $169.40 (2-year minimum), then $84.70/yr");
    assert.equal(term.termPhrase(com, term.termOf(com)), "for $14.50/yr");
    assert.equal(term.termPhrase(com, term.termOf(com, 2)), "for 2 years: $29.00, then $14.50/yr");
  });

  it("gives a dry run the years, min_years above 1 and the total", () => {
    assert.deepEqual(term.termFields(term.termOf(ai)), { years: 2, min_years: 2, total_price: 169.4 });
    assert.deepEqual(term.termFields(term.termOf(com)), { years: 1, total_price: 14.5 });
  });

  it("names the bulk names bought for more than a year", () => {
    assert.equal(term.longerTerms([{ domain: "doobeedoo.com", term: term.termOf(com) }]), "");
    assert.equal(
      term.longerTerms([{ domain: "doobeedoo.ai", term: term.termOf(ai) }, { domain: "doobeedoo.com", term: term.termOf(com, 3) }]),
      " (doobeedoo.ai for 2 years, the .ai minimum; doobeedoo.com for 3 years)",
    );
  });
});

describe("--years", () => {
  it("accepts a whole number of years from 1 to 10", () => {
    assert.equal(term.parseYears(undefined), undefined);
    assert.equal(term.parseYears("1"), 1);
    assert.equal(term.parseYears(" 10 "), 10);
  });

  it("refuses anything else", () => {
    for (const bad of ["0", "11", "2.5", "-1", "two", "2y", ""]) assert.equal(term.parseYears(bad), null, bad);
  });

  it("below the TLD's minimum is the server's TERM_BELOW_MINIMUM, with the minimum term's total", () => {
    const refusal = term.belowMinimum("doobeedoo.ai", ai, 1);
    assert.deepEqual(refusal, { domain: "doobeedoo.ai", requested_years: 1, min_years: 2, price: 169.4 });
    assert.equal(
      term.belowMinimumMessage([refusal!]),
      "doobeedoo.ai cannot be registered for 1 year: .ai names are registered for at least 2 years, $169.40 in total.",
    );
    assert.equal(term.belowMinimum("doobeedoo.ai", ai, 2), undefined);
    assert.equal(term.belowMinimum("doobeedoo.ai", ai, undefined), undefined);
    assert.equal(term.belowMinimum("doobeedoo.com", com, 1), undefined);
  });
});

describe("the server's term and registrar refusals", () => {
  it("keep their code and get the flag that fixes them", () => {
    assert.deepEqual(term.buyRefusal({ code: "TERM_BELOW_MINIMUM", min_years: 2 }), { code: "TERM_BELOW_MINIMUM", hint: "Re-run with --years 2, or leave --years out for the minimum term." });
    assert.equal(term.buyRefusal({ code: "TERM_BELOW_MINIMUM", terms: [{ min_years: 2 }, { min_years: 3 }] })?.hint, "Re-run with --years 3, or leave --years out for the minimum term.");
    assert.deepEqual(term.buyRefusal({ code: "TERM_NOT_SUPPORTED", suggested_years: 2 }), { code: "TERM_NOT_SUPPORTED", hint: "Re-run with --years 2." });
    assert.deepEqual(term.buyRefusal({ code: "REGISTRAR_UNAVAILABLE", retry_after: 60 }), { code: "REGISTRAR_UNAVAILABLE", hint: "Try again in 60 seconds." });
    assert.deepEqual(term.buyRefusal({ code: "REGISTRAR_UNAVAILABLE", hint: "Later." }), { code: "REGISTRAR_UNAVAILABLE", hint: "Later." });
  });

  it("leave every other answer to the generic failure", () => {
    assert.equal(term.buyRefusal({ code: "PRICE_ABOVE_MAX", price: 1 }), undefined);
    assert.equal(term.buyRefusal({ error: "Payment method required" }), undefined);
  });
});

class Exit extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("buy and search against a stubbed API", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realError = console.error;
  const realExit = process.exit;
  let printed: string[] = [];
  let errors: string[] = [];
  let posted: Array<Record<string, unknown>> = [];
  let respondToBuy: () => Response = () => new Response("{}");

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const sse = (events: Array<[string, unknown]>) =>
    new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const byName: Record<string, unknown> = { "doobeedoo.ai": ai, "doobeedoo.com": com };

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/api/tlds") return json({ tlds: [{ tld: "ai" }, { tld: "com" }], total: 2, offset: 0, limit: null });
      if (url.pathname === "/api/domains/search" && url.searchParams.get("domains")) {
        return sse([["result", ai], ["result", com], ["done", { total: 2, available: 2 }]]);
      }
      if (url.pathname === "/api/domains/search") return json(byName[url.searchParams.get("q") ?? ""] ?? { available: false });
      if (url.pathname === "/api/domains/buy") {
        posted.push(JSON.parse(String(init?.body ?? "{}")));
        return respondToBuy();
      }
      return json({});
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    process.exit = ((code?: number | string | null) => { throw new Exit(code); }) as typeof process.exit;
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realError;
    process.exit = realExit;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function reset(handler: () => Response = () => json({})) {
    printed = [];
    errors = [];
    posted = [];
    respondToBuy = handler;
  }

  // eslint-disable-next-line no-control-regex
  const plain = (lines: string[]) => lines.join("\n").replace(/\u001b\[[0-9;]*m/gu, "");
  const lastJson = () => JSON.parse(printed.at(-1) ?? "{}");
  const exits = (err: unknown) => err instanceof Exit && err.code === 1;

  it("a .ai dry run states its 2-year term and caps the charge at its total", async () => {
    reset();
    await buy(["doobeedoo.ai"], { json: true, dryRun: true });
    const out = lastJson();
    assert.equal(out.price, 84.7);
    assert.equal(out.renewal_price, 84.7);
    assert.equal(out.years, 2);
    assert.equal(out.min_years, 2);
    assert.equal(out.total_price, 169.4);
    assert.equal(out.max_price, 169.4);
    assert.equal(out.purchase, undefined);
    assert.equal(posted.length, 0);
  });

  it("a .com dry run keeps one year and has no min_years", async () => {
    reset();
    await buy(["doobeedoo.com"], { json: true, dryRun: true });
    const out = lastJson();
    assert.equal(out.years, 1);
    assert.equal("min_years" in out, false);
    assert.equal(out.total_price, 14.5);
    assert.equal(out.max_price, 14.5);
  });

  it("a human .ai dry run says the years, the total and the minimum", async () => {
    reset();
    await buy(["doobeedoo.ai"], { dryRun: true });
    assert.match(plain(printed), /purchase: doobeedoo\.ai for 2 years: \$169\.40 \(2-year minimum\), then \$84\.70\/yr/u);
  });

  it("--years longer than the minimum is sent and capped at its own total", async () => {
    reset(() => sse([["available", { domain: "doobeedoo.ai", years: 3 }], ["registered", { domain: "doobeedoo.ai", years: 3 }]]));
    await buy(["doobeedoo.ai"], { json: true, years: "3" });
    assert.deepEqual(posted, [{ domain: "doobeedoo.ai", years: 3, max_price: 254.1 }]);
    assert.equal(lastJson().years, 3);
  });

  it("without --years the buy leaves years to the server and caps at the minimum term's total", async () => {
    reset(() => sse([["registered", { domain: "doobeedoo.ai", years: 2 }]]));
    await buy(["doobeedoo.ai"], { json: true });
    assert.deepEqual(posted, [{ domain: "doobeedoo.ai", max_price: 169.4 }]);
  });

  it("--years below the minimum is refused before any buy, as TERM_BELOW_MINIMUM", async () => {
    reset();
    await assert.rejects(buy(["doobeedoo.ai"], { json: true, years: "1" }), exits);
    assert.equal(posted.length, 0);
    const out = lastJson();
    assert.equal(out.code, "TERM_BELOW_MINIMUM");
    assert.equal(out.requested_years, 1);
    assert.equal(out.min_years, 2);
    assert.equal(out.price, 169.4);
    assert.match(out.error, /at least 2 years, \$169\.40 in total/u);
    assert.match(out.hint, /--years 2/u);
  });

  it("an invalid --years fails validation before any call", async () => {
    reset();
    await assert.rejects(buy(["doobeedoo.ai"], { json: true, years: "11" }), exits);
    assert.equal(posted.length, 0);
    assert.equal(lastJson().code, "validation_error");
  });

  it("a bulk buy puts each name at its own minimum and caps the order at the sum of the terms", async () => {
    reset(() => json({ results: [{ domain: "doobeedoo.ai", success: true }, { domain: "doobeedoo.com", success: true }], summary: { succeeded: 2, failed: 0 } }));
    await buy(["doobeedoo.ai", "doobeedoo.com"], { json: true });
    assert.deepEqual(posted, [{ domains: ["doobeedoo.ai", "doobeedoo.com"], max_price: 183.9 }]);
  });

  it("a bulk dry run lists each name's term", async () => {
    reset();
    await buy(["doobeedoo.ai", "doobeedoo.com"], { json: true, dryRun: true, years: "3" });
    const out = lastJson();
    assert.deepEqual(out.domains, [
      { domain: "doobeedoo.ai", price: 84.7, renewal_price: 84.7, years: 3, min_years: 2, total_price: 254.1 },
      { domain: "doobeedoo.com", price: 14.5, renewal_price: 14.5, years: 3, total_price: 43.5 },
    ]);
    assert.equal(out.total_price, 297.6);
    assert.equal(out.max_price, 297.6);
  });

  it("a bulk --years below a name's minimum is refused before any buy", async () => {
    reset();
    await assert.rejects(buy(["doobeedoo.ai", "doobeedoo.com"], { json: true, years: "1" }), exits);
    assert.equal(posted.length, 0);
    assert.deepEqual(lastJson().terms, [{ domain: "doobeedoo.ai", requested_years: 1, min_years: 2, price: 169.4 }]);
  });

  it("a server TERM_BELOW_MINIMUM passes its body in --json", async () => {
    const body = {
      error: "doobeedoo.ai cannot be registered for 1 year: .ai names are registered for at least 2 years, $169.40 in total. Nothing was charged. Retry with years: 2, or leave years out.",
      code: "TERM_BELOW_MINIMUM", hint: "Nothing was charged.", requested_years: 1, min_years: 2, price: 169.4,
    };
    reset(() => json(body, 400));
    // Search knew no minimum, so only the server can refuse.
    byName["doobeedoo.ai"] = { ...ai, min_years: undefined, min_term_price: undefined };
    try {
      await assert.rejects(buy(["doobeedoo.ai"], { json: true, years: "1" }), exits);
    } finally {
      byName["doobeedoo.ai"] = ai;
    }
    assert.equal(posted.length, 1);
    assert.deepEqual(lastJson(), body);
  });

  it("a streamed REGISTRAR_UNAVAILABLE prints the server's words as they are", async () => {
    const error = "Our registrar is not answering right now. Nothing was charged.";
    reset(() => sse([["error", { error, code: "REGISTRAR_UNAVAILABLE", retry_after: 60 }]]));
    await assert.rejects(buy(["doobeedoo.com"], { yes: true }), exits);
    const out = plain(errors);
    assert.ok(out.includes(error), out);
    assert.match(out, /Try again in 60 seconds/u);
  });

  it("search shows the minimum term and its total, and --json passes the fields through", async () => {
    reset();
    await search("doobeedoo", ["ai", "com"], {});
    const lineOf = (domain: string) => plain(printed).split("\n").find((l) => l.includes(domain)) ?? "";
    assert.match(lineOf("doobeedoo.ai"), /\$169\.40 for 2 years \(2-year minimum\), then \$84\.70\/yr/u);
    assert.match(lineOf("doobeedoo.com"), /\$14\.50\/yr/u);
    reset();
    await search("doobeedoo", ["ai", "com"], { json: true });
    const row = lastJson().results.find((r: { domain: string }) => r.domain === "doobeedoo.ai");
    assert.equal(row.min_years, 2);
    assert.equal(row.min_term_price, 169.4);
  });
});
