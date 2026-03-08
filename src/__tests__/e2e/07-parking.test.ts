import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, skipIfNoAuth, skipIfNoMutate, TEST_DOMAIN } from "./helpers.js";

describe("parking & analytics workflow", () => {
  describe("parking (read)", () => {
    it("shows parking status", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["parking", TEST_DOMAIN]);
      assertSuccess(result);
      assertField(result.data, "domain");
      assertField(result.data, "parking_enabled");
    });
  });

  describe("analytics", () => {
    it("shows parking analytics", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["analytics", TEST_DOMAIN]);
      assertSuccess(result);
    });
  });

  describe("parking lifecycle", () => {
    it("enable → price → unprice → disable", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      // Save initial state
      const initial = run(["parking", TEST_DOMAIN]);
      assertSuccess(initial);
      const wasEnabled = (initial.data as Record<string, unknown>).parking_enabled;
      const originalPrice = (initial.data as Record<string, unknown>).listing_price;

      // Enable (may fail with 409 if DNS conflict)
      const enableResult = run(["parking", TEST_DOMAIN, "enable", "--yes"], { expectError: true });
      if (enableResult.exitCode !== 0) {
        // DNS conflict or already enabled — skip the rest
        return;
      }

      // Set price
      const priceResult = run(["parking", TEST_DOMAIN, "price", "12345"]);
      assertSuccess(priceResult);
      assert.equal((priceResult.data as Record<string, unknown>).listing_price, 12345);

      // Unprice
      const unpriceResult = run(["parking", TEST_DOMAIN, "unprice"]);
      assertSuccess(unpriceResult);
      assert.equal((unpriceResult.data as Record<string, unknown>).listing_price, null);

      // Restore
      if (!wasEnabled) {
        run(["parking", TEST_DOMAIN, "disable"], { expectError: true });
      }
      if (originalPrice) {
        run(["parking", TEST_DOMAIN, "price", String(originalPrice)], { expectError: true });
      }
    });
  });
});
