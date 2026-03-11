import { apiRequest } from "../api.js";
import pc from "picocolors";
import { fmt, heading, row, blank, hintCommand, table, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

const BARS = " ▁▂▃▄▅▆▇█";

function sparkline(values: number[]): string {
  const max = Math.max(...values, 1);
  return values
    .map((v) => BARS[Math.min(Math.round((v / max) * 8), 8)])
    .join("");
}

export async function analytics(
  domain: string | undefined,
  options: { json?: boolean; fields?: string },
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  const s = createSpinner(!options.json);
  s.start(`Loading analytics for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/analytics`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`Analytics loaded`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  blank();
  heading(`Analytics: ${fmt.domain(domain)}`);

  row("Views (7d)", pc.cyan(data.views_7d.toLocaleString()));
  row("Views (30d)", pc.cyan(data.views_30d.toLocaleString()));
  row("Inquiries", pc.cyan(String(data.inquiries_30d)));
  row("Conversion", data.conversion_rate > 0
    ? pc.green(`${data.conversion_rate}%`)
    : pc.dim("0%"));

  // Sparkline
  if (data.daily_views && data.daily_views.length > 0) {
    const values = data.daily_views.map((d: { views: number }) => d.views);
    const line = sparkline(values);
    const first = data.daily_views[0].date.slice(5);
    const last = data.daily_views[data.daily_views.length - 1].date.slice(5);
    blank();
    console.log(`  ${pc.dim(first)} ${pc.cyan(line)} ${pc.dim(last)}`);
  }

  // Recent inquiries
  if (data.recent_inquiries && data.recent_inquiries.length > 0) {
    blank();
    console.log(`  ${pc.bold("Recent Inquiries")}`);
    const rows = data.recent_inquiries.map((inq: { email: string; offer: number | null; date: string }) => [
      pc.dim(inq.email),
      inq.offer ? fmt.price(inq.offer) : pc.dim("-"),
      pc.dim(new Date(inq.date).toLocaleDateString()),
    ]);
    table(["Email", "Offer", "Date"], rows, [30, 12, 14]);
  }

  blank();
  hintCommand("Set a listing price:", `domani parking ${domain} price <amount>`);
  hintCommand("Set up email:", `domani email setup ${domain}`);
  hintCommand("Domain settings:", `domani settings ${domain}`);
  blank();
}
