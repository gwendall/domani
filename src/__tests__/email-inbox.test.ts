import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inboxQuery } from "../commands/email.js";

describe("domani email inbox query (#649)", () => {
  it("sends the page cursor, so --cursor fetches the next page instead of the first again", () => {
    const qs = inboxQuery({ limit: "50", cursor: "eyJ0IjoiMjAyNi0xMC0xMVQxMDowMDowMC4wMDBaIiwiaWQiOiJhYmMifQ" });
    const params = new URLSearchParams(qs.slice(1));
    assert.equal(params.get("cursor"), "eyJ0IjoiMjAyNi0xMC0xMVQxMDowMDowMC4wMDBaIiwiaWQiOiJhYmMifQ");
    assert.equal(params.get("limit"), "50");
  });

  it("sends the time window and labels with the folder filters", () => {
    const params = new URLSearchParams(inboxQuery({
      folder: "archive",
      direction: "in",
      since: "2026-10-01T00:00:00Z",
      until: "2026-10-08T00:00:00Z",
      label: "billing,urgent",
    }).slice(1));
    assert.deepEqual(Object.fromEntries(params), {
      direction: "in",
      folder: "archive",
      since: "2026-10-01T00:00:00Z",
      until: "2026-10-08T00:00:00Z",
      label: "billing,urgent",
    });
  });

  it("omits the query string when nothing is set", () => {
    assert.equal(inboxQuery({}), "");
  });
});
