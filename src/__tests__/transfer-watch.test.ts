import assert from "node:assert/strict";
import test from "node:test";
import { waitForEligibility } from "../transfer-eligibility.js";

interface Plan { eligible: boolean; tag?: string }

const noSleep = async () => {};

test("returns the eligible plan as soon as a poll reports eligibility", async () => {
  const polls: Array<Plan | null> = [
    { eligible: false },
    { eligible: false },
    { eligible: true, tag: "third" },
  ];
  let sleeps = 0;
  const outcome = await waitForEligibility<Plan>({
    fetchPlan: async () => polls.shift() ?? null,
    isEligible: (p) => p.eligible,
    sleep: async () => { sleeps++; },
    intervalMs: 1,
    maxAttempts: 10,
  });
  assert.equal(outcome.status, "eligible");
  assert.equal(outcome.status === "eligible" && outcome.plan.tag, "third");
  // Slept between attempts, but not after the eligible one.
  assert.equal(sleeps, 2);
});

test("times out after maxAttempts when the domain never becomes eligible", async () => {
  let attempts = 0;
  const outcome = await waitForEligibility<Plan>({
    fetchPlan: async () => { attempts++; return { eligible: false }; },
    isEligible: (p) => p.eligible,
    sleep: noSleep,
    intervalMs: 1,
    maxAttempts: 5,
  });
  assert.deepEqual(outcome, { status: "timeout", attempts: 5 });
  assert.equal(attempts, 5);
});

test("gives up after consecutive fetch failures", async () => {
  const outcome = await waitForEligibility<Plan>({
    fetchPlan: async () => { throw new Error("network down"); },
    isEligible: (p) => p.eligible,
    sleep: noSleep,
    intervalMs: 1,
    maxAttempts: 100,
    maxConsecutiveFailures: 3,
  });
  assert.deepEqual(outcome, { status: "unreachable", failures: 3 });
});

test("a successful poll resets the failure counter", async () => {
  // Alternating failure/success must never accumulate to the failure cap.
  let call = 0;
  const outcome = await waitForEligibility<Plan>({
    fetchPlan: async () => {
      call++;
      if (call % 2 === 1) return null;
      return { eligible: call >= 8 };
    },
    isEligible: (p) => p.eligible,
    sleep: noSleep,
    intervalMs: 1,
    maxAttempts: 20,
    maxConsecutiveFailures: 2,
  });
  assert.equal(outcome.status, "eligible");
});

test("reports each attempt through onTick, including failures", async () => {
  const seen: Array<{ attempt: number; gotPlan: boolean }> = [];
  const polls: Array<Plan | null> = [null, { eligible: false }, { eligible: true }];
  await waitForEligibility<Plan>({
    fetchPlan: async () => polls.shift() ?? null,
    isEligible: (p) => p.eligible,
    sleep: noSleep,
    intervalMs: 1,
    maxAttempts: 10,
    onTick: (plan, attempt) => seen.push({ attempt, gotPlan: plan !== null }),
  });
  assert.deepEqual(seen, [
    { attempt: 1, gotPlan: false },
    { attempt: 2, gotPlan: true },
    { attempt: 3, gotPlan: true },
  ]);
});
