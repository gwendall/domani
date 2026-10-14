/** True when each year after the first costs another price than the first, compared in cents. */
export function renewalDiffers(price: number, renewal: number | undefined): renewal is number {
  return renewal !== undefined && Math.round(renewal * 100) !== Math.round(price * 100);
}

/** "$14.50/yr", or "$69.00 first year, then $107.00/yr" when each later year costs something else. */
export function perYear(price: number, renewal?: number): string {
  return renewalDiffers(price, renewal)
    ? `$${price.toFixed(2)} first year, then $${renewal.toFixed(2)}/yr`
    : `$${price.toFixed(2)}/yr`;
}
