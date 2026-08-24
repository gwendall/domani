export interface WebhookHeaderEnvOptions {
  authorizationEnv?: string;
  apiKeyEnv?: string;
  clearHeaders?: boolean;
}

/**
 * Resolve supported webhook auth headers without putting secret values in CLI
 * arguments. Callers should only render the returned header names.
 */
export function resolveWebhookHeadersFromEnv(
  options: WebhookHeaderEnvOptions,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (options.clearHeaders && (options.authorizationEnv || options.apiKeyEnv)) {
    throw new Error("--clear-headers cannot be combined with header environment options");
  }
  if (options.clearHeaders) return {};

  const headers: Record<string, string> = {};
  const mappings: Array<[string, string | undefined]> = [
    ["Authorization", options.authorizationEnv],
    ["X-API-Key", options.apiKeyEnv],
  ];

  for (const [headerName, envName] of mappings) {
    if (!envName) continue;
    const value = environment[envName];
    if (!value) {
      throw new Error(`Environment variable ${envName} is not set`);
    }
    headers[headerName] = value;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function webhookHeaderNames(headers: Record<string, string> | undefined): string[] {
  return headers ? Object.keys(headers) : [];
}
