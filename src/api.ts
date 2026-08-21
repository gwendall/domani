import { getApiUrl, getToken, CLI_VERSION } from "./config.js";
import { ensurePaidPlan } from "./auth.js";

/** Wrap response so .json() never throws on non-JSON bodies */
function safeResponse(res: Response): Response {
  res.json = async () => {
    const text = await res.clone().text();
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.trim().slice(0, 120);
      if (res.ok) {
        // Callers gate on res.ok: flip it so a 2xx with a non-JSON body
        // (proxy/deploy hiccup) takes the error path instead of being
        // treated as a success with missing fields.
        Object.defineProperty(res, "ok", { value: false });
        return {
          error: `Unexpected non-JSON response (HTTP ${res.status})`,
          hint: `The server replied but not with JSON${snippet ? ` (got: "${snippet}")` : ""}. This is usually transient (deploy or proxy) - retry in a few seconds.`,
        };
      }
      return { error: `Server error (${res.status})`, hint: "The server returned an unexpected response. Try again later." };
    }
  };
  return res;
}

export async function apiRequest(
  path: string,
  options: RequestInit = {},
  _retrying = false
): Promise<Response> {
  const token = getToken()!;
  const url = `${getApiUrl()}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `domani-cli/${CLI_VERSION}`,
      ...options.headers,
    },
  });

  // Inline upgrade flow — same pattern as ensureAuth
  if (!_retrying) {
    const text = await res.clone().text();
    try {
      const data = JSON.parse(text);
      if (data.code === "UPGRADE_REQUIRED") {
        await ensurePaidPlan();
        return apiRequest(path, options, true);
      }
    } catch { /* not JSON, skip */ }
  }

  return safeResponse(res);
}

export async function publicRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${getApiUrl()}${path}`;
  const token = getToken();

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `domani-cli/${CLI_VERSION}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return safeResponse(res);
}
