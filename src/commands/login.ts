import { getApiUrl, saveConfig, getConfig } from "../config.js";
import pc from "picocolors";
import { S, fmt, blank, hintCommand, errorMessage, createSpinner, openUrl, jsonOut, fail } from "../ui.js";

export async function login(options: { json?: boolean }): Promise<void> {
  const apiUrl = getApiUrl();
  const s = createSpinner(!options.json);

  // Check if already logged in
  const config = getConfig();
  if (config.token) {
    s.start("Checking session");
    try {
      const meRes = await fetch(`${apiUrl}/api/me`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        s.stop(`Already logged in as ${pc.bold(me.email)}`);
        if (options.json) {
          jsonOut({ status: "already_logged_in", email: me.email });
        }
        return;
      }
    } catch {
      // Token invalid or network error, proceed with login
    }
    s.stop("Session expired, re-authenticating");
    blank();
  }

  s.start("Requesting auth code");

  const res = await fetch(`${apiUrl}/api/auth/cli`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    s.stop("Failed to initiate login");
    try {
      const data = await res.json();
      fail(data.error || data.message || `Server error (${res.status})`, { hint: data.hint, code: "login_failed", json: options.json });
    } catch {
      fail(`Could not reach ${apiUrl}. Check your connection and try again.`, { code: "network_error", json: options.json });
    }
  }

  const { code, auth_url, expires_in } = await res.json();
  s.stop("Auth code received");

  if (options.json) {
    jsonOut({ status: "awaiting_approval", code, auth_url, expires_in });
    return;
  }

  blank();
  console.log(`  ${pc.dim("Verification code:")} ${pc.bold(pc.cyan(code))}`);
  console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(auth_url)}`);
  blank();

  openUrl(auth_url);

  s.start("Waiting for approval");

  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(`${apiUrl}/api/auth/cli/poll?code=${code}`);
    if (!pollRes.ok && pollRes.status !== 202) {
      s.stop("Login failed");
      fail(`Server error (${pollRes.status})`, { code: "login_failed" });
    }
    const data = await pollRes.json();

    if (data.status === "complete") {
      saveConfig({ ...getConfig(), token: data.token, email: data.email, api_url: apiUrl });
      s.stop(`Logged in as ${pc.bold(data.email)}`);
      blank();
      hintCommand("Get started:", `domani search`);
      blank();
      return;
    }

    if (data.error) {
      s.stop("Login failed");
      fail(data.error || data.message, { hint: data.hint, code: "login_failed" });
    }
  }

  s.stop("Login timed out");
  fail("No approval received within 10 minutes", { hint: "Run 'domani login' to try again", code: "timeout" });
}
