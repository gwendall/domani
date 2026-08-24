import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPaidPlan, isPaidAccountPlan } from "../auth.js";

describe("paid plan detection", () => {
  it("accepts every personal and workspace paid plan and rejects free or unknown plans", () => {
    for (const plan of ["pro", "agent", "fleet", "scale", "mail_solo", "mail_team", "mail_business"]) {
      assert.equal(isPaidAccountPlan(plan), true, plan);
    }
    for (const plan of ["free", "unknown", null, undefined]) {
      assert.equal(isPaidAccountPlan(plan), false, String(plan));
    }
  });

  it("recognizes paid workspace plans returned by the account endpoint", () => {
    assert.equal(hasPaidPlan({ plan: "free", workspace_plans: ["mail_team"] }), true);
    assert.equal(hasPaidPlan({ plan: "free", workspace_plans: ["free"] }), false);
    assert.equal(hasPaidPlan({ plan: "agent", workspace_plans: [] }), true);
    assert.equal(hasPaidPlan({ plan: "free" }), false);
  });
});
