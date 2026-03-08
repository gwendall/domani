import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateDomain,
  validateTld,
  validateInput,
  validateDomains,
  validateTlds,
  checkControlChars,
  checkPathTraversal,
  checkQueryFragment,
  checkPercentEncoding,
} from "../validate.js";

// ── Helper ───────────────────────────────────────────

function expectOk(result: { ok: boolean }) {
  assert.equal(result.ok, true, `Expected ok, got error: ${JSON.stringify(result)}`);
}

function expectError(result: { ok: boolean; error?: { code?: string } }, expectedCode?: string) {
  assert.equal(result.ok, false, `Expected error, got ok`);
  if (expectedCode && !result.ok && result.error) {
    assert.equal(result.error.code, expectedCode);
  }
}

// ── validateDomain ───────────────────────────────────

describe("validateDomain", () => {
  it("accepts valid domains", () => {
    expectOk(validateDomain("example.com"));
    expectOk(validateDomain("my-app.dev"));
    expectOk(validateDomain("sub.domain.co.uk"));
    expectOk(validateDomain("a.io"));
    expectOk(validateDomain("x.ai"));
    expectOk(validateDomain("test123.xyz"));
  });

  it("accepts single-label names (for search)", () => {
    expectOk(validateDomain("myapp"));
    expectOk(validateDomain("test123"));
  });

  it("rejects empty input", () => {
    expectError(validateDomain(""), "validation_error");
  });

  it("rejects path traversal", () => {
    expectError(validateDomain("../etc/passwd"), "invalid_input");
    expectError(validateDomain("..\\windows\\system32"), "invalid_input");
    expectError(validateDomain("../../.ssh/id_rsa"), "invalid_input");
  });

  it("rejects control characters", () => {
    expectError(validateDomain("example\x00.com"), "invalid_input");
    expectError(validateDomain("test\x07domain.com"), "invalid_input");
    expectError(validateDomain("\x1bexample.com"), "invalid_input");
  });

  it("rejects query strings and fragments", () => {
    expectError(validateDomain("example.com?fields=name"), "invalid_input");
    expectError(validateDomain("example.com#section"), "invalid_input");
  });

  it("rejects percent-encoded input", () => {
    expectError(validateDomain("example%2Ecom"), "invalid_input");
    expectError(validateDomain("%2e%2e/etc/passwd"), "invalid_input");
  });

  it("rejects domains that are too long", () => {
    const long = "a".repeat(254) + ".com";
    expectError(validateDomain(long), "validation_error");
  });

  it("rejects invalid characters", () => {
    expectError(validateDomain("example .com"), "validation_error");
    expectError(validateDomain("exam!ple.com"), "validation_error");
    expectError(validateDomain("example@domain.com"), "validation_error");
  });

  it("rejects domains starting or ending with hyphen", () => {
    expectError(validateDomain("-example.com"), "validation_error");
    expectError(validateDomain("example-.com"), "validation_error");
  });
});

// ── validateTld ──────────────────────────────────────

describe("validateTld", () => {
  it("accepts valid TLDs", () => {
    expectOk(validateTld("com"));
    expectOk(validateTld("dev"));
    expectOk(validateTld("ai"));
    expectOk(validateTld(".io"));
    expectOk(validateTld(".xyz"));
  });

  it("rejects empty", () => {
    expectError(validateTld(""), "validation_error");
  });

  it("rejects TLDs with numbers", () => {
    expectError(validateTld("c0m"), "validation_error");
  });

  it("rejects TLDs with special characters", () => {
    expectError(validateTld("co.uk"), "validation_error");
    expectError(validateTld("com!"), "validation_error");
  });

  it("rejects control characters in TLDs", () => {
    expectError(validateTld("com\x00"), "invalid_input");
  });
});

// ── validateInput ────────────────────────────────────

describe("validateInput", () => {
  it("accepts normal text", () => {
    expectOk(validateInput("AI coding assistant for startups"));
    expectOk(validateInput("my-project"));
  });

  it("rejects control characters", () => {
    expectError(validateInput("test\x00input"), "invalid_input");
  });

  it("rejects excessively long input", () => {
    expectError(validateInput("a".repeat(1001)), "validation_error");
  });

  it("accepts input at max length", () => {
    expectOk(validateInput("a".repeat(1000)));
  });
});

// ── Batch validators ─────────────────────────────────

describe("validateDomains", () => {
  it("accepts valid domain list", () => {
    expectOk(validateDomains(["foo.com", "bar.dev", "baz.ai"]));
  });

  it("rejects if any domain is invalid", () => {
    expectError(validateDomains(["foo.com", "../evil", "bar.dev"]), "invalid_input");
  });

  it("accepts empty list", () => {
    expectOk(validateDomains([]));
  });
});

describe("validateTlds", () => {
  it("accepts valid TLD list", () => {
    expectOk(validateTlds(["com", "dev", "ai"]));
  });

  it("rejects if any TLD is invalid", () => {
    expectError(validateTlds(["com", "123", "dev"]), "validation_error");
  });
});

// ── Individual checks ────────────────────────────────

describe("checkControlChars", () => {
  it("passes clean strings", () => {
    expectOk(checkControlChars("hello world"));
    expectOk(checkControlChars("test\ttab")); // tab is allowed (0x09)
    expectOk(checkControlChars("line\nbreak")); // newline is allowed (0x0A)
  });

  it("catches null bytes", () => {
    expectError(checkControlChars("test\x00"), "invalid_input");
  });

  it("catches bell character", () => {
    expectError(checkControlChars("test\x07"), "invalid_input");
  });
});

describe("checkPathTraversal", () => {
  it("passes normal paths", () => {
    expectOk(checkPathTraversal("example.com"));
    expectOk(checkPathTraversal("sub.domain.com"));
  });

  it("catches unix traversal", () => {
    expectError(checkPathTraversal("../etc/passwd"), "invalid_input");
  });

  it("catches windows traversal", () => {
    expectError(checkPathTraversal("..\\windows"), "invalid_input");
  });
});

describe("checkQueryFragment", () => {
  it("passes clean input", () => {
    expectOk(checkQueryFragment("example.com"));
  });

  it("catches query string", () => {
    expectError(checkQueryFragment("example.com?foo=bar"), "invalid_input");
  });

  it("catches fragment", () => {
    expectError(checkQueryFragment("example.com#section"), "invalid_input");
  });
});

describe("checkPercentEncoding", () => {
  it("passes clean input", () => {
    expectOk(checkPercentEncoding("example.com"));
  });

  it("catches percent-encoded chars", () => {
    expectError(checkPercentEncoding("example%2Ecom"), "invalid_input");
  });

  it("catches double-encoded traversal", () => {
    expectError(checkPercentEncoding("%2e%2e/etc"), "invalid_input");
  });
});
