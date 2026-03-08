import { getToken } from "../config.js";
import { blank, fail, jsonOut } from "../ui.js";

export function token(options: { json?: boolean }): void {
  const key = getToken();
  if (!key) {
    blank();
    fail("Not logged in", { hint: "Run 'domani login' first", code: "auth_required", json: options.json });
  }

  if (options.json) {
    jsonOut({ token: key });
  } else {
    console.log(key);
  }
}
