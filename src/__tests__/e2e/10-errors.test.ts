import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, runNoAuth, assertError, skipIfNoAuth } from "./helpers.js";

describe("error cases", () => {
  describe("input validation", () => {
    it("rejects path traversal in domain", () => {
      const result = run(["whois", "../etc/passwd"], { expectError: true });
      assertError(result, "invalid_input");
    });

    it("rejects query string in domain", () => {
      const result = run(["whois", "example.com?foo=bar"], { expectError: true });
      assertError(result, "invalid_input");
    });

    it("rejects percent-encoded domain", () => {
      const result = run(["whois", "example%2Ecom"], { expectError: true });
      assertError(result, "invalid_input");
    });

    it("rejects path traversal in search", () => {
      const result = run(["search", "../../etc"], { expectError: true });
      assertError(result, "invalid_input");
    });
  });

  describe("missing arguments", () => {
    it("dns set without type/name/value", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["dns", "example.com", "set"], { expectError: true });
      assertError(result, "validation_error");
    });

    it("dns delete without type/name", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["dns", "example.com", "delete"], { expectError: true });
      assertError(result, "validation_error");
    });
  });

  describe("authentication", () => {
    it("returns auth_required without API key", () => {
      const result = runNoAuth(["me"]);
      assertError(result, "auth_required");
      const data = result.data as Record<string, unknown>;
      assert.equal(data.fix_command, "domani login");
    });

    it("returns auth_required for list without key", () => {
      const result = runNoAuth(["list"]);
      assertError(result, "auth_required");
    });
  });

  describe("parking price validation", () => {
    it("rejects NaN parking price", () => {
      const result = run(["parking", "example.com", "price", "abc"], { expectError: true });
      assertError(result, "validation_error");
      const data = result.data as Record<string, unknown>;
      assert.ok(String(data.error).includes("positive number"), `Expected positive number error, got: ${data.error}`);
    });

    it("rejects negative parking price", () => {
      const result = run(["parking", "example.com", "price", "-50"], { expectError: true });
      assertError(result, "validation_error");
    });

    it("rejects zero parking price", () => {
      const result = run(["parking", "example.com", "price", "0"], { expectError: true });
      assertError(result, "validation_error");
    });
  });

  describe("invalid domains", () => {
    it("rejects domain with spaces", () => {
      const result = run(["whois", "exam ple.com"], { expectError: true });
      assertError(result, "validation_error");
    });

    it("rejects domain with special characters", () => {
      const result = run(["whois", "exam!ple.com"], { expectError: true });
      assertError(result, "validation_error");
    });

    it("rejects domain starting with hyphen", () => {
      const result = run(["whois", "-example.com"], { expectError: true });
      // Commander might interpret this as a flag, so we accept any error
      assert.notEqual(result.exitCode, 0);
    });
  });

  describe("buy errors", () => {
    it("returns not_available for a taken domain", () => {
      const result = run(["buy", "google.com", "--yes"], { expectError: true });
      assertError(result, "not_available");
    });

    it("returns auth_required for buy without API key", () => {
      const result = runNoAuth(["buy", "example.xyz", "--yes"]);
      assertError(result, "auth_required");
    });

    it("rejects buy without domain argument in non-TTY", () => {
      // In non-TTY (piped), missing domain should fail with missing_argument
      const result = run(["buy", "--yes"], { expectError: true });
      assert.notEqual(result.exitCode, 0);
    });

    it("rejects buy with invalid domain format", () => {
      const result = run(["buy", "../etc/passwd", "--yes"], { expectError: true });
      assertError(result, "invalid_input");
    });
  });

  describe("renew errors", () => {
    it("rejects invalid years value", () => {
      const result = run(["renew", "example.com", "--years", "abc", "--yes"], { expectError: true });
      assertError(result, "validation_error");
    });

    it("rejects years out of range", () => {
      const result = run(["renew", "example.com", "--years", "11", "--yes"], { expectError: true });
      assertError(result, "validation_error");
    });

    it("rejects zero years", () => {
      const result = run(["renew", "example.com", "--years", "0", "--yes"], { expectError: true });
      assertError(result, "validation_error");
    });
  });

  describe("transfer errors", () => {
    it("rejects transfer with invalid domain", () => {
      const result = run(["transfer", "../etc/passwd", "--auth-code", "test123", "--yes"], { expectError: true });
      assertError(result, "invalid_input");
    });
  });
});
