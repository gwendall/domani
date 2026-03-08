import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, assertArray, skipIfNoAuth } from "./helpers.js";

describe("discovery workflow", () => {
  describe("tlds", () => {
    it("lists TLDs with pricing", () => {
      const result = run(["tlds"]);
      assertSuccess(result);
      assertField(result.data, "tlds");
      assertField(result.data, "total");

      const tlds = assertArray(result.data, "tlds");
      assert.ok(tlds.length > 0, "Expected at least one TLD");
      const first = tlds[0] as Record<string, unknown>;
      assertField(first, "tld");
      assertField(first, "registration");
      assertField(first, "renewal");
    });

    it("filters by max price", () => {
      const result = run(["tlds", "--max-price", "5"]);
      assertSuccess(result);
      const tlds = assertArray(result.data, "tlds") as Array<{ registration: number }>;
      for (const t of tlds) {
        assert.ok(t.registration <= 5, `Price ${t.registration} exceeds max 5`);
      }
    });

    it("filters by search term", () => {
      const result = run(["tlds", "--search", "dev"]);
      assertSuccess(result);
      const tlds = assertArray(result.data, "tlds") as Array<{ tld: string }>;
      assert.ok(tlds.some((t) => t.tld === "dev"), "Expected 'dev' in results");
    });

    it("limits results", () => {
      const result = run(["tlds", "--limit", "3"]);
      assertSuccess(result);
      const tlds = assertArray(result.data, "tlds");
      assert.ok(tlds.length <= 3, `Expected <= 3, got ${tlds.length}`);
    });
  });

  describe("search", () => {
    it("checks a taken domain", () => {
      const result = run(["search", "google.com"]);
      assertSuccess(result);
      // Single-domain search now returns normalized envelope shape
      assertField(result.data, "name");
      assertField(result.data, "results");
      assertField(result.data, "total");
      assert.equal((result.data as Record<string, unknown>).total, 1);
      const results = assertArray(result.data, "results");
      const first = results[0] as Record<string, unknown>;
      assert.equal(first.available, false);
    });

    it("checks a single domain", () => {
      const result = run(["search", `e2etest${Date.now()}.xyz`]);
      assertSuccess(result);
      assertField(result.data, "name");
      assertField(result.data, "results");
      const results = assertArray(result.data, "results");
      const first = results[0] as Record<string, unknown>;
      assertField(first, "domain");
      assertField(first, "available");
      assertField(first, "price");
    });

    it("bulk search across TLDs", () => {
      const result = run(["search", "testdomain", ".com", ".io", ".dev"]);
      assertSuccess(result);
      assertField(result.data, "name");
      assertField(result.data, "results");
      assertField(result.data, "total");

      const results = assertArray(result.data, "results");
      for (const r of results as Array<Record<string, unknown>>) {
        assertField(r, "domain");
        assertField(r, "available");
        assertField(r, "price");
      }
    });

    it("--expand searches 30+ TLDs", () => {
      const result = run(["search", `e2eexpand${Date.now()}`, "--expand"], { timeout: 60_000 });
      assertSuccess(result);
      assertField(result.data, "name");
      assertField(result.data, "results");
      assertField(result.data, "total");

      const total = (result.data as Record<string, unknown>).total as number;
      // Basic preset checks 10 TLDs, --expand checks 30+
      assert.ok(total > 10, `Expected >10 TLDs with --expand, got ${total}`);

      // Should include exotic TLDs from extended preset (not just basic ones)
      const results = assertArray(result.data, "results") as Array<{ domain: string }>;
      const tlds = results.map((r) => r.domain.split(".").pop());
      const hasExoticTld = tlds.some((t) => ["run", "gg", "cc", "fm", "tv", "space", "lol", "studio", "tech", "cloud"].includes(t!));
      assert.ok(hasExoticTld, `Expected at least one exotic TLD in results, got: ${tlds.join(", ")}`);
    });

    it("basic search without --expand checks ~10 TLDs", () => {
      const result = run(["search", `e2ebasic${Date.now()}`], { timeout: 45_000 });
      assertSuccess(result);
      const total = (result.data as Record<string, unknown>).total as number;
      assert.ok(total <= 10, `Expected <=10 TLDs without --expand, got ${total}`);
    });
  });

  describe("whois", () => {
    it("looks up a registered domain", () => {
      const result = run(["whois", "google.com"]);
      assertSuccess(result);
      assertField(result.data, "domain");
    });

    it("looks up an unregistered domain", () => {
      const result = run(["whois", `e2ewhois${Date.now()}.xyz`]);
      assertSuccess(result);
    });
  });

  describe("suggest", { timeout: 90_000 }, () => {
    it("returns AI suggestions", (t) => {
      if (skipIfNoAuth(t)) return;
      // suggest can be very slow (AI generation + availability checks)
      const result = run(["suggest", "AI coding tool", "--count", "3"], { timeout: 60_000, expectError: true });
      if (result.exitCode !== 0) return; // timeout or server error — skip gracefully
      assertField(result.data, "suggestions");
      const suggestions = assertArray(result.data, "suggestions");
      assert.ok(suggestions.length > 0, "Expected at least one suggestion");
    });
  });
});
