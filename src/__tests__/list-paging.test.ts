import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-paging-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { notifications, notificationsQuery } = await import("../commands/notifications.js");
const { deals, dealsQuery } = await import("../commands/deals.js");
const { httpRoute, httpRoutesQuery } = await import("../commands/http-route.js");
const { contactsQuery } = await import("../commands/email.js");

const CURSOR = "eyJ0IjoiMjAyNi0xMC0xMVQxMDowMDowMC4wMDBaIiwiaWQiOiJhYmMifQ";
const NEXT = "eyJ0IjoiMjAyNi0xMC0wOVQxMDowMDowMC4wMDBaIiwiaWQiOiJ4eXoifQ";

function params(qs: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(qs.replace(/^\?/u, "")));
}

describe("list query strings send the page cursor (#649)", () => {
  it("notifications: unread, limit and cursor", () => {
    assert.deepEqual(params(notificationsQuery({ unread: true, limit: "20", cursor: CURSOR })), { unread: "true", limit: "20", cursor: CURSOR });
    assert.equal(notificationsQuery({}), "");
  });

  it("deals: role, status, limit and cursor", () => {
    assert.deepEqual(params(dealsQuery({ role: "seller", status: "active", limit: "10", cursor: CURSOR })), { role: "seller", status: "active", limit: "10", cursor: CURSOR });
    assert.equal(dealsQuery({}), "");
  });

  it("route list: filters, limit and cursor", () => {
    assert.deepEqual(
      params(httpRoutesQuery({ domain: "example.com", hostname: "preview.example.com", status: "all", limit: "5", cursor: "route_abc" })),
      { domain: "example.com", hostname: "preview.example.com", status: "all", limit: "5", cursor: "route_abc" },
    );
    assert.equal(httpRoutesQuery({}), "");
  });

  it("email contacts: the stable order travels with its cursor", () => {
    assert.deepEqual(params(contactsQuery({ q: "acme", limit: "100", order: "created", cursor: CURSOR })), { q: "acme", limit: "100", order: "created", cursor: CURSOR });
    assert.equal(contactsQuery({}), "");
  });
});

describe("list commands page end to end against a stubbed API (#649)", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  let requested: URL[] = [];
  let printed: string[] = [];
  let body: unknown = {};

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function reset(response: unknown) {
    requested = [];
    printed = [];
    body = response;
  }

  // Colors are off when stdout is not a TTY; strip them anyway so the match is exact.
  // eslint-disable-next-line no-control-regex
  const plain = () => printed.join("\n").replace(/\u001b\[[0-9;]*m/gu, "");

  it("notifications --cursor fetches that page and prints the next cursor", async () => {
    reset({ notifications: [{ type: "domain_expiring", title: "Renew", body: "soon", read: false, created_at: "2026-10-10T00:00:00Z" }], unread_count: 1, has_more: true, next_cursor: NEXT });
    await notifications({ cursor: CURSOR, limit: "1" });
    assert.equal(requested.length, 1);
    assert.equal(requested[0].pathname, "/api/notifications");
    assert.equal(requested[0].searchParams.get("cursor"), CURSOR);
    assert.match(plain(), new RegExp(`More: --cursor ${NEXT}`, "u"));
  });

  it("notifications prints no cursor on the last page", async () => {
    reset({ notifications: [{ type: "domain_expiring", title: "Renew", read: true, created_at: "2026-10-10T00:00:00Z" }], unread_count: 0, has_more: false, next_cursor: null });
    await notifications({});
    assert.equal(requested[0].search, "");
    assert.doesNotMatch(plain(), /More: --cursor/u);
  });

  it("deals --cursor fetches that page and prints the next cursor", async () => {
    reset({ deals: [{ id: "deal_1", domain: "example.com", price: 1000, status: "active", role: "seller", created_at: "2026-10-10T00:00:00Z" }], has_more: true, next_cursor: NEXT });
    await deals(undefined, { cursor: CURSOR, limit: "1" });
    assert.equal(requested[0].pathname, "/api/deals");
    assert.equal(requested[0].searchParams.get("cursor"), CURSOR);
    assert.equal(requested[0].searchParams.get("limit"), "1");
    assert.match(plain(), new RegExp(`More: --cursor ${NEXT}`, "u"));
  });

  it("route list --cursor fetches that page and prints the next cursor", async () => {
    reset({ http_routes: [{ id: "route_2", hostname: "a.example.com", status: "active", upstream: "http://127.0.0.1:3000" }], next_cursor: "route_2" });
    await httpRoute("list", undefined, { cursor: "route_3", limit: "1" });
    assert.equal(requested[0].pathname, "/api/http-routes");
    assert.equal(requested[0].searchParams.get("cursor"), "route_3");
    assert.match(plain(), /More: --cursor route_2/u);
  });

  it("route list prints no cursor on the last page", async () => {
    reset({ http_routes: [], next_cursor: null });
    await httpRoute(undefined, undefined, {});
    assert.equal(requested[0].search, "");
    assert.doesNotMatch(plain(), /More: --cursor/u);
  });
});
