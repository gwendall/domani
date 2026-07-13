import { getToken } from "../config.js";
import { blank, fail, jsonOut } from "../ui.js";

export function token(options: { json?: boolean; reveal?: boolean }): void {
  const key = getToken();
  if (!key) {
    blank();
    fail("Not logged in", { hint: "Run 'domani login' first", code: "auth_required", json: options.json });
  }

  // Don't print the secret to an interactive terminal unless asked - shell
  // history and screen shares leak. Pipes/scripts (non-TTY) get it raw.
  if (!options.reveal && !options.json && process.stdout.isTTY) {
    const masked = `${key!.slice(0, 12)}...${key!.slice(-4)}`;
    console.log(masked);
    console.log("Run 'domani token --reveal' to print the full key.");
    return;
  }

  if (options.json) {
    jsonOut({ token: key });
  } else {
    console.log(key);
  }
}
