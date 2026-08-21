import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPaidAccountPlan } from "../auth.js";

describe("paid plan detection", () => {
  it("accepts every personal paid plan and rejects free or workspace plans", () => {
    for (const plan of ["pro", "agent", "fleet", "scale"]) {
      assert.equal(isPaidAccountPlan(plan), true, plan);
    }
    for (const plan of ["free", "mail_solo", "mail_team", "mail_business", null, undefined]) {
      assert.equal(isPaidAccountPlan(plan), false, String(plan));
    }
  });
});
