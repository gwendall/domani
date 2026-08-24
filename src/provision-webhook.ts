import { resolveWebhookHeadersFromEnv, webhookHeaderNames, type WebhookHeaderEnvOptions } from "./webhook-headers.js";

export function resolveProvisionWebhook(
  webhookUrl: string | undefined,
  options: WebhookHeaderEnvOptions,
  environment: NodeJS.ProcessEnv = process.env,
): {
  request: { webhook_url?: string; webhook_headers?: Record<string, string> };
  preview: { webhook_url?: string; webhook_header_names?: string[] };
} {
  const headers = resolveWebhookHeadersFromEnv(options, environment);
  if (headers !== undefined && !webhookUrl) {
    throw new Error("--webhook is required when setting webhook authentication");
  }

  return {
    request: {
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
      ...(headers !== undefined ? { webhook_headers: headers } : {}),
    },
    preview: {
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
      ...(headers !== undefined ? { webhook_header_names: webhookHeaderNames(headers) } : {}),
    },
  };
}
