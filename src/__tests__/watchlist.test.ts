import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the CLI from the real config and keychain before any module reads them.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "domani-cli-watchlist-"));
process.env.DOMANI_CONFIG_DIR = configDir;
process.env.DOMANI_API_KEY = "test-placeholder-key";

const { follow, unfollow, watchlist, phaseLabel, day, forSaleLabel } = await import("../commands/watchlist.js");

describe("watchlist labels", () => {
  it("names each step in words", () => {
    assert.equal(phaseLabel("pending_delete"), "pending delete");
    assert.equal(phaseLabel("unknown"), "checking");
    assert.equal(phaseLabel("redemption"), "redemption");
  });

  it("shows the day only, and a dash when the registry does not publish it", () => {
    assert.equal(day("2027-03-14T08:00:00.000Z"), "2027-03-14");
    assert.equal(day(null), "-");
    assert.equal(day(undefined), "-");
  });

  it("names the marketplace and its price when known", () => {
    assert.equal(forSaleLabel({ source: "Afternic", price: 2500 }), "Afternic $2500");
    assert.equal(forSaleLabel({ source: "Sedo", price: null }), "Sedo");
    assert.equal(forSaleLabel(null), "-");
  });
});

describe("follow, unfollow and watchlist against a stubbed API", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realError = console.error;
  const realExit = process.exit;
  let requests: { url: URL; method: string; body: unknown }[] = [];
  let printed: string[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };

  before(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
    console.error = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); };
    process.exit = ((code?: number) => { throw new Error(`exit ${code}`); }) as typeof process.exit;
  });

  after(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realError;
    process.exit = realExit;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function reset(status: number, body: unknown) {
    requests = [];
    printed = [];
    reply = { status, body };
  }

  // eslint-disable-next-line no-control-regex
  const plain = () => printed.join("\n").replace(/\u001b\[[0-9;]*m|\u001b\]8;;[^\u001b]*\u001b\\/gu, "");
  const watch = { domain: "taken.com", phase: "expiring", expires_at: "2026-11-20T00:00:00.000Z", for_sale: null, backorder_id: null };

  it("follow posts the name and says where it stands", async () => {
    reset(201, { watch });
    await follow("taken.com", {});
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url.pathname, "/api/watchlist");
    assert.deepEqual(requests[0].body, { domain: "taken.com" });
    assert.match(plain(), /Now\s+expiring/u);
    assert.match(plain(), /Expires\s+2026-11-20/u);
  });

  it("follow --json prints the server's answer as is", async () => {
    reset(200, { watch });
    await follow("taken.com", { json: true });
    assert.deepEqual(JSON.parse(printed.join("\n")), { watch });
  });

  it("follow --dry-run sends nothing", async () => {
    reset(201, { watch });
    await follow("taken.com", { dryRun: true, json: true });
    assert.equal(requests.length, 0);
    assert.deepEqual(JSON.parse(printed.join("\n")), { dry_run: true, action: "follow", domain: "taken.com" });
  });

  it("follow refuses a malformed name before any request", async () => {
    reset(201, { watch });
    await assert.rejects(follow("taken.com/../x", { json: true }), /exit 1/u);
    assert.equal(requests.length, 0);
  });

  it("the 50-name limit is not mistaken for a sign-in problem", async () => {
    reset(403, { error: "You follow 50 names already. Unfollow one to follow taken.com.", code: "WATCHLIST_LIMIT" });
    await assert.rejects(follow("taken.com", { json: true }), /exit 1/u);
    const out = JSON.parse(printed.join("\n"));
    assert.equal(out.code, "limit_reached");
    assert.equal(out.fix_command, undefined);
  });

  it("unfollow deletes the name", async () => {
    reset(200, { deleted: true });
    await unfollow("taken.com", { json: true });
    assert.equal(requests[0].method, "DELETE");
    assert.equal(requests[0].url.pathname, "/api/watchlist/taken.com");
    assert.deepEqual(JSON.parse(printed.join("\n")), { deleted: true });
  });

  it("unfollow of a name you do not follow fails as not found", async () => {
    reset(404, { error: "You do not follow taken.com.", code: "WATCH_NOT_FOUND" });
    await assert.rejects(unfollow("taken.com", { json: true }), /exit 1/u);
    assert.equal(JSON.parse(printed.join("\n")).code, "not_found");
  });

  it("watchlist lists each name with its step, expiry, sale and backorder", async () => {
    reset(200, {
      watches: [
        watch,
        { domain: "drop.io", phase: "pending_delete", expires_at: null, for_sale: { source: "Afternic", price: 900 }, backorder_id: "bo_1" },
      ],
    });
    await watchlist({});
    assert.equal(requests[0].url.pathname, "/api/watchlist");
    const out = plain();
    assert.match(out, /taken\.com\s+expiring\s+2026-11-20\s+-\s+-/u);
    assert.match(out, /drop\.io\s+pending delete\s+-\s+Afternic \$900\s+yes/u);
  });

  it("watchlist says so when nothing is followed", async () => {
    reset(200, { watches: [] });
    await watchlist({});
    assert.match(plain(), /You follow no names yet\./u);
    assert.match(plain(), /domani follow <domain>/u);
  });
});
