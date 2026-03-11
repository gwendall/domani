import { apiRequest } from "../api.js";
import pc from "picocolors";
import { confirm, isCancel } from "@clack/prompts";
import { S, fmt, heading, row, blank, createSpinner, openUrl, fail, jsonOut } from "../ui.js";

export async function cardList(options: { json?: boolean; fields?: string }): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading payment method");

  const res = await apiRequest("/api/me");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  if (options.json) {
    s.stop("");
    jsonOut(
      data.card
        ? { has_payment_method: data.has_payment_method, card: data.card }
        : { has_payment_method: false },
      options.fields,
    );
    return;
  }

  if (!data.has_payment_method || !data.card) {
    s.stop("No payment method on file");
    blank();
    console.log(`  ${pc.dim("Add a card with")} ${pc.cyan("domani card add")}`);
    blank();
    return;
  }

  const { brand, last4, exp_month, exp_year } = data.card;
  const expiry = `${String(exp_month).padStart(2, "0")}/${exp_year}`;
  const brandLabel = brand.charAt(0).toUpperCase() + brand.slice(1);

  s.stop("Payment method loaded");
  heading("Payment method");
  row("Card", `${pc.bold(brandLabel)} •••• ${pc.bold(last4)}`);
  row("Expires", expiry);
  blank();
  console.log(`  ${pc.dim("Update with")} ${pc.cyan("domani card add")}`);
  blank();
}

export async function cardAdd(options?: { json?: boolean }): Promise<void> {
  const s = createSpinner(!options?.json);
  s.start("Setting up payment session");

  const res = await apiRequest("/api/billing/setup", {
    method: "POST",
    body: JSON.stringify({ mode: "checkout" }),
  });

  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options?.json });
  }

  if (!data.url) {
    s.stop("Failed");
    fail("No checkout URL returned", { json: options?.json });
  }

  s.stop("Checkout ready");

  if (options?.json) {
    jsonOut({ url: data.url });
    return;
  }

  blank();
  console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(data.url)}`);
  blank();

  openUrl(data.url);

  console.log(`  ${S.info} ${pc.dim("Complete payment setup in your browser.")}`);
  console.log(`  ${pc.dim("  After setup, you can purchase domains with")} ${pc.cyan("domani buy")}`);
  blank();
}

export async function cardRemove(options?: { json?: boolean; yes?: boolean }): Promise<void> {
  if (!options?.yes && !options?.json) {
    const ok = await confirm({ message: "Remove your saved payment method?" });
    if (isCancel(ok) || !ok) {
      console.log(`  ${pc.dim("Cancelled.")}`);
      process.exit(0);
    }
  }

  const s = createSpinner(!options?.json);
  s.start("Removing payment method");

  const res = await apiRequest("/api/billing/card", { method: "DELETE" });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options?.json });
  }

  s.stop(`${S.success} Payment method removed`);

  if (options?.json) {
    jsonOut({ removed: true });
    return;
  }

  blank();
  console.log(`  ${pc.dim("Add a new card with")} ${pc.cyan("domani card add")}`);
  blank();
}
