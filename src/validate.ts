/**
 * Input hardening — catches common AI agent hallucinations and malformed input.
 *
 * Agents sometimes fabricate domain names with path traversal, control characters,
 * query strings, or double-encoded payloads. These validators reject bad input
 * early with clear error messages and fix hints.
 */

// ── Patterns ─────────────────────────────────────────

/** ASCII control characters (0x00–0x1F) except tab/newline */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

/** Path traversal sequences */
const PATH_TRAVERSAL_RE = /\.\.[/\\]/;

/** Query string or fragment in a domain */
const QUERY_FRAGMENT_RE = /[?#]/;

/** Percent-encoded sequences (double-encoding attack) */
const PERCENT_ENCODED_RE = /%[0-9a-fA-F]{2}/;

/** Valid domain: letters, digits, hyphens, dots, and optionally a trailing dot */
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.?$/;

/** Valid TLD: letters only, 2-63 chars (with optional leading dot) */
const TLD_RE = /^\.?[a-zA-Z]{2,63}$/;

/** Max reasonable length for a domain input */
const MAX_DOMAIN_LENGTH = 253;

/** Max reasonable length for any freeform input */
const MAX_INPUT_LENGTH = 1000;

// ── Result type ──────────────────────────────────────

export interface ValidationError {
  message: string;
  code: string;
  hint?: string;
}

type Result = { ok: true } | { ok: false; error: ValidationError };

function ok(): Result {
  return { ok: true };
}

function err(message: string, code: string, hint?: string): Result {
  return { ok: false, error: { message, code, hint } };
}

// ── Validators ───────────────────────────────────────

/** Reject control characters in any input */
export function checkControlChars(input: string): Result {
  if (CONTROL_CHAR_RE.test(input)) {
    return err(
      "Input contains control characters",
      "invalid_input",
      "Remove non-printable characters from the input",
    );
  }
  return ok();
}

/** Reject path traversal attempts */
export function checkPathTraversal(input: string): Result {
  if (PATH_TRAVERSAL_RE.test(input)) {
    return err(
      "Input contains path traversal",
      "invalid_input",
      "Domain names cannot contain '../' or '..\\'",
    );
  }
  return ok();
}

/** Reject query strings or fragments in domain-like input */
export function checkQueryFragment(input: string): Result {
  if (QUERY_FRAGMENT_RE.test(input)) {
    return err(
      "Input contains query string or fragment",
      "invalid_input",
      "Remove '?' or '#' from the domain name",
    );
  }
  return ok();
}

/** Reject percent-encoded sequences (double-encoding attacks) */
export function checkPercentEncoding(input: string): Result {
  if (PERCENT_ENCODED_RE.test(input)) {
    return err(
      "Input contains percent-encoded characters",
      "invalid_input",
      "Use plain text, not URL-encoded values (e.g. 'example.com' not 'example%2Ecom')",
    );
  }
  return ok();
}

/** Validate a domain name */
export function validateDomain(input: string): Result {
  if (!input) {
    return err("Domain name is required", "validation_error");
  }

  if (input.length > MAX_DOMAIN_LENGTH) {
    return err(
      `Domain name too long (${input.length} chars, max ${MAX_DOMAIN_LENGTH})`,
      "validation_error",
    );
  }

  // Run hardening checks
  for (const check of [checkControlChars, checkPathTraversal, checkQueryFragment, checkPercentEncoding]) {
    const result = check(input);
    if (!result.ok) return result;
  }

  if (!DOMAIN_RE.test(input)) {
    return err(
      `Invalid domain name: ${input}`,
      "validation_error",
      "Domain names can only contain letters, digits, hyphens, and dots",
    );
  }

  return ok();
}

/** Validate a TLD (with or without leading dot) */
export function validateTld(input: string): Result {
  if (!input) {
    return err("TLD is required", "validation_error");
  }

  const check = checkControlChars(input);
  if (!check.ok) return check;

  if (!TLD_RE.test(input)) {
    return err(
      `Invalid TLD: ${input}`,
      "validation_error",
      "TLDs contain only letters (e.g. 'com', '.dev', 'ai')",
    );
  }

  return ok();
}

/** Validate generic text input (no control chars, reasonable length) */
export function validateInput(input: string): Result {
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input too long (${input.length} chars, max ${MAX_INPUT_LENGTH})`,
      "validation_error",
    );
  }

  return checkControlChars(input);
}

// ── Batch helper ─────────────────────────────────────

/** Validate multiple domains, return first error or ok */
export function validateDomains(domains: string[]): Result {
  for (const d of domains) {
    const result = validateDomain(d);
    if (!result.ok) return result;
  }
  return ok();
}

/** Validate multiple TLDs, return first error or ok */
export function validateTlds(tlds: string[]): Result {
  for (const t of tlds) {
    const result = validateTld(t);
    if (!result.ok) return result;
  }
  return ok();
}

// ── Require helpers (exit on failure) ────────────────

import { fail } from "./ui.js";

interface FailOpts { json?: boolean; fields?: string }

/** Validate a domain or exit with a structured error */
export function requireValidDomain(domain: string, opts?: FailOpts): void {
  const r = validateDomain(domain);
  if (!r.ok) fail(r.error.message, { code: r.error.code, hint: r.error.hint, json: opts?.json, fields: opts?.fields });
}

/** Validate multiple domains or exit with a structured error */
export function requireValidDomains(domains: string[], opts?: FailOpts): void {
  const r = validateDomains(domains);
  if (!r.ok) fail(r.error.message, { code: r.error.code, hint: r.error.hint, json: opts?.json, fields: opts?.fields });
}

/** Validate TLDs or exit with a structured error */
export function requireValidTlds(tlds: string[], opts?: FailOpts): void {
  const r = validateTlds(tlds);
  if (!r.ok) fail(r.error.message, { code: r.error.code, hint: r.error.hint, json: opts?.json, fields: opts?.fields });
}
