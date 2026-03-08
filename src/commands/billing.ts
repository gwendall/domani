import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, blank, createSpinner, openUrl, fail } from "../ui.js";

export async function billing(): Promise<void> {
  const s = createSpinner();
  s.start("Setting up billing session");

  const res = await apiRequest("/api/billing/setup", {
    method: "POST",
    body: JSON.stringify({ mode: "checkout" }),
  });

  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status });
  }

  if (!data.url) {
    s.stop("Failed");
    fail("No checkout URL returned", { hint: "Try again or add a payment method at the dashboard." });
  }

  s.stop("Checkout ready");

  blank();
  console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(data.url)}`);
  blank();

  openUrl(data.url);

  console.log(`  ${S.info} ${pc.dim("Complete payment setup in your browser.")}`);
  console.log(`  ${pc.dim("  After setup, you can purchase domains with")} ${pc.cyan("domani buy")}`);
  blank();
}
