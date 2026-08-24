import { getApiUrl, saveConfig, getConfig, getToken } from "../config.js";
import pc from "picocolors";
import { S, fmt, blank, hintCommand, createSpinner, openUrl, jsonOut, fail } from "../ui.js";

export interface LoginOptions {
  json?: boolean;
  open?: boolean;
  scopes?: string;
  label?: string;
  expiresIn?: string;
  surface?: string;
}

const PROGRAMMATIC_SURFACES = new Set(["cli", "mcp", "plugin", "skill", "api"]);

export function buildLoginRequest(options: LoginOptions): {
  body: { scopes?: string[]; label?: string; expires_in?: number; surface: string; intent: "programmatic_access" };
  delegated: boolean;
} {
  const scopes = options.scopes
    ?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const delegated = Boolean(scopes?.length || options.label || options.expiresIn);
  const surface = options.surface || "cli";
  if (!PROGRAMMATIC_SURFACES.has(surface)) {
    throw new RangeError("--surface must be one of: cli, mcp, plugin, skill, api");
  }
  const expiresIn = options.expiresIn === undefined ? undefined : Number(options.expiresIn);
  if (
    expiresIn !== undefined
    && (!Number.isInteger(expiresIn) || expiresIn < 3600 || expiresIn > 31_536_000)
  ) {
    throw new RangeError("--expires-in must be an integer between 3600 and 31536000 seconds");
  }
  return {
    delegated,
    body: {
      ...(scopes?.length ? { scopes } : {}),
      ...(options.label ? { label: options.label } : {}),
      ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
      surface,
      intent: "programmatic_access",
    },
  };
}

export async function login(options: LoginOptions): Promise<void> {
  const apiUrl = getApiUrl();
  const s = createSpinner(!options.json);
  let request: ReturnType<typeof buildLoginRequest>;
  try {
    request = buildLoginRequest(options);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid login options", {
      code: "invalid_expires_in",
      json: options.json,
    });
  }
  const { body, delegated } = request;

  // Check if already logged in
  const config = getConfig();
  const existingToken = getToken();
  if (existingToken && !delegated) {
    s.start("Checking session");
    try {
      const meRes = await fetch(`${apiUrl}/api/me`, {
        headers: { Authorization: `Bearer ${existingToken}` },
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
    body: JSON.stringify(body),
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
  if (options.open !== false) {
    console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(auth_url)}`);
    openUrl(auth_url);
  } else {
    console.log(`  ${pc.dim("Open this URL to approve:")} ${fmt.url(auth_url)}`);
  }
  blank();

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
      console.log(`  ${pc.bold("Get one real result:")}`);
      hintCommand("1. Create your free inbox:", "domani email create YOUR_HANDLE@domani.run");
      hintCommand("2. Connect your webhook:", "domani email webhook YOUR_HANDLE@domani.run --url https://YOUR_AGENT/webhook");
      hintCommand("3. Prove delivery:", "domani email webhook-test YOUR_HANDLE@domani.run");
      console.log(`  ${pc.dim("A custom domain can wait until this loop works.")}`);
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
