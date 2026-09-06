import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentsUsageError, buildAgentsRequest } from "../commands/agents.js";

describe("domani agents request planning", () => {
  it("lists identities, mints and lists confined keys, revokes one", () => {
    assert.deepEqual(buildAgentsRequest(undefined, undefined, {}), { method: "GET", path: "/api/agents/identity" });
    assert.deepEqual(buildAgentsRequest("token", "dave", { name: "Dave on the pod", mailboxes: "mb_1, mb_2" }), { method: "POST", path: "/api/agents/identity/dave/tokens", body: { name: "Dave on the pod", mailbox_ids: ["mb_1", "mb_2"] } });
    assert.deepEqual(buildAgentsRequest("tokens", "dave", {}), { method: "GET", path: "/api/agents/identity/dave/tokens" });
    assert.deepEqual(buildAgentsRequest("revoke-token", "dave", { tokenId: "tok_1" }), { method: "DELETE", path: "/api/agents/identity/dave/tokens/tok_1" });
    assert.throws(() => buildAgentsRequest("token", undefined, {}), (error: unknown) => error instanceof AgentsUsageError);
    assert.throws(() => buildAgentsRequest("revoke-token", "dave", {}), (error: unknown) => error instanceof AgentsUsageError);
  });
});
