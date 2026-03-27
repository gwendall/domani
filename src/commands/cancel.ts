import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, blank, createSpinner, fail, jsonOut } from "../ui.js";

export async function cancel(options?: { json?: boolean; fields?: string }): Promise<void> {
  const s = createSpinner(!options?.json);
  s.start("Cancelling subscription");

  const res = await apiRequest("/api/billing/cancel", { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    if (data.code === "NOT_PRO") {
      fail("You're not on the Pro plan.", { json: options?.json });
    } else {
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options?.json });
    }
    return;
  }

  s.stop("Done");

  if (options?.json) {
    jsonOut(data, options?.fields);
    return;
  }

  blank();
  const until = data.cancel_at ? new Date(data.cancel_at).toLocaleDateString() : "end of billing period";
  console.log(`  ${S.success} ${pc.dim("Subscription cancelled.")} Access continues until ${pc.cyan(until)}.`);
  blank();
}
