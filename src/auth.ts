import pc from "picocolors";
import { getApiUrl, getToken, saveConfig, getConfig, isTTY } from "./config.js";
import { S, fmt, blank, createSpinner, openUrl } from "./ui.js";

/** Memoized — resolves instantly on subsequent calls within the same process. */
let _authEnsured = false;
let _proEnsured = false;

export function resetAuthCache(): void {
  _authEnsured = false;
  _proEnsured = false;
}

/**
 * Ensure the user is on Pro before proceeding.
 *
 * - If already Pro: instant no-op.
 * - If TTY: opens billing page, polls until upgraded, continues.
 * - If non-TTY: structured error exit.
 */
export async function ensurePro(): Promise<void> {
  if (_proEnsured) return;

  const isJson = process.argv.includes("--json") || !isTTY;
  const apiUrl = getApiUrl();
  const token = getToken();

  // Check current plan
  try {
    const res = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.plan === "pro") { _proEnsured = true; return; }
  } catch { /* proceed to upgrade flow */ }

  if (isJson) {
    console.log(JSON.stringify({
      error: "Pro plan required",
      code: "upgrade_required",
      hint: "Upgrade at https://domani.run/settings",
      fix_command: "domani upgrade",
    }, null, 2));
    process.exit(1);
  }

  blank();
  console.log(`  ${pc.dim("This feature requires")} ${pc.bold("Pro")} ${pc.dim("($9/month).")}`);
  console.log(`  ${pc.dim("Opening billing page")} ${S.arrow} ${pc.cyan("domani.run/settings")}`);
  openUrl(`${apiUrl.replace("http://localhost:3000", "https://domani.run")}/settings`);
  blank();

  const s = createSpinner(true);
  s.start("Waiting for upgrade...");

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(`${apiUrl}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.plan === "pro") {
        _proEnsured = true;
        s.stop(`${S.success} Upgraded to Pro! Continuing...`);
        blank();
        return;
      }
    } catch { /* keep polling */ }
  }

  s.stop("Timed out");
  console.error(`  ${pc.red("✗")} No upgrade detected. Visit ${pc.cyan("domani.run/settings")} to upgrade.`);
  process.exit(1);
}

/**
 * Ensure the user is authenticated before proceeding.
 *
 * - If a token already exists: instant no-op.
 * - If TTY and no token: inline device login flow (opens browser, polls, saves token).
 * - If non-TTY or --json and no token: prints structured error and exits (agent-safe).
 */
export async function ensureAuth(): Promise<void> {
  if (_authEnsured || getToken()) {
    _authEnsured = true;
    return;
  }

  const isJson = process.argv.includes("--json") || !isTTY;

  if (isJson) {
    console.log(JSON.stringify({
      error: "Not logged in",
      code: "auth_required",
      hint: "Run 'domani login' or set DOMANI_API_KEY environment variable",
      fix_command: "domani login",
    }, null, 2));
    process.exit(1);
  }

  // Inline device login flow
  blank();
  console.log(`  ${pc.dim("You're not logged in.")} Starting authentication...`);
  blank();

  const apiUrl = getApiUrl();
  const s = createSpinner(true);
  s.start("Requesting auth code");

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/auth/cli`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    s.stop("Failed");
    console.error(`  ${pc.red("✗")} Could not reach ${apiUrl}. Check your connection.`);
    process.exit(1);
  }

  if (!res.ok) {
    s.stop("Failed");
    let msg = `Server error (${res.status})`;
    try { const d = await res.json(); msg = d.error || d.message || msg; } catch { /* ignore */ }
    console.error(`  ${pc.red("✗")} ${msg}`);
    process.exit(1);
  }

  let code: string, auth_url: string;
  try {
    ({ code, auth_url } = await res.json());
  } catch {
    s.stop("Failed");
    console.error(`  ${pc.red("✗")} Invalid response from server.`);
    process.exit(1);
  }
  s.stop(`${S.success} Auth code ready`);

  blank();
  console.log(`  ${pc.dim("Verification code:")} ${pc.bold(pc.cyan(code))}`);
  console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(auth_url)}`);
  openUrl(auth_url);
  blank();

  s.start("Waiting for browser approval");

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`${apiUrl}/api/auth/cli/poll?code=${code}`).catch(() => null);
    if (!poll || (!poll.ok && poll.status !== 202)) continue;
    const data = await poll.json().catch(() => ({}));
    if (data.status === "complete") {
      saveConfig({ ...getConfig(), token: data.token, email: data.email, api_url: apiUrl });
      _authEnsured = true;
      s.stop(`${S.success} Logged in as ${pc.bold(data.email)}`);
      blank();
      return;
    }
  }

  s.stop("Timed out");
  console.error(`  ${pc.red("✗")} No approval received. Run ${pc.cyan("domani login")} to try again.`);
  process.exit(1);
}
