import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, blank, createSpinner, openUrl, fail, jsonOut } from "../ui.js";

export async function upgrade(options?: { json?: boolean; fields?: string }): Promise<void> {
  const s = createSpinner(!options?.json);
  s.start("Creating upgrade session");

  const res = await apiRequest("/api/billing/subscribe", { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    if (data.code === "ALREADY_PRO") {
      fail("You're already on the Pro plan.", { json: options?.json });
    } else {
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options?.json });
    }
    return;
  }

  s.stop("Ready");

  if (options?.json) {
    jsonOut({ url: data.url }, options?.fields);
    return;
  }

  blank();
  console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(data.url)}`);
  blank();
  openUrl(data.url);
  console.log(`  ${S.info} ${pc.dim("Complete your Pro upgrade in the browser.")}`);
  blank();
}
