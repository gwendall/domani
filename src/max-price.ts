import { fail } from "./ui.js";

/** A USD amount rounded to the cent, as the buy compares a ceiling. */
export function roundToCent(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** The total a PRICE_ABOVE_MAX refusal asks the user to accept, when it carries one. */
export function priceToAccept(payload: { code?: unknown; price?: unknown }): number | undefined {
  return payload.code === "PRICE_ABOVE_MAX" && typeof payload.price === "number" ? payload.price : undefined;
}

/** What to tell a caller nobody can ask: the flag that accepts the new price. */
export function acceptPriceHint(price: number): string {
  return `Nothing was charged. Re-run with --max-price ${price.toFixed(2)} to accept the new price.`;
}

/** The ceiling --max-price asks for, or undefined when the flag is absent. */
export function parseMaxPrice(value: string | undefined, options: { json?: boolean; fields?: string }): number | undefined {
  if (value === undefined) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    fail(`--max-price must be a positive amount in USD, got "${value}"`, { code: "validation_error", json: options.json, fields: options.fields });
  }
  return amount;
}
