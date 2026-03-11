import { clearConfig, getConfig, saveConfig } from "../config.js";
import pc from "picocolors";
import { S, jsonOut } from "../ui.js";

export async function logout(options: { json?: boolean }): Promise<void> {
  const config = getConfig();
  if (!config.token) {
    if (options.json) {
      jsonOut({ status: "not_logged_in" });
    } else {
      console.log(`  ${pc.dim("Not logged in.")}`);
    }
    return;
  }

  const { api_url } = config;
  clearConfig();
  // Preserve api_url so local dev setup survives logout
  if (api_url) saveConfig({ api_url });
  if (options.json) {
    jsonOut({ status: "logged_out", email: config.email || null });
  } else {
    console.log(`  ${S.success} Logged out${config.email ? ` ${pc.dim(`(${config.email})`)}` : ""}`);
  }
}
