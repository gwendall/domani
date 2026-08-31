import { createHash } from "crypto";
import fs from "fs";
import { getApiUrl, CLI_VERSION } from "../config.js";
import pc from "picocolors";
import { S, blank, createSpinner, fail, jsonOut } from "../ui.js";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function update(options?: { json?: boolean; yes?: boolean }): Promise<void> {
  const jsonMode = !!options?.json;
  const s = createSpinner(!jsonMode);
  s.start("Checking for updates");

  const apiUrl = getApiUrl();

  try {
    const res = await fetch(`${apiUrl}/api/cli/version`);
    if (!res.ok) {
      s.stop("Failed");
      fail("Could not check for updates");
    }

    const data = await res.json();
    const latest = data.version;
    const expectedHash: string | undefined = data.sha256;

    if (compareVersions(latest, CLI_VERSION) <= 0) {
      s.stop(`${S.success} Already up to date (v${CLI_VERSION})`);
      if (jsonMode) {
        jsonOut({ current: CLI_VERSION, latest, up_to_date: true });
      }
      return;
    }

    if (jsonMode && !options?.yes) {
      s.stop("");
      // JSON mode stays check-only unless --yes opts in: scripts rely on
      // `--json` never replacing the binary out from under them. Non-TTY
      // runs are auto-switched to JSON, so the hint must name a command
      // that actually updates in that mode - plain `domani update` is the
      // command that just produced this output.
      jsonOut({
        current: CLI_VERSION,
        latest,
        up_to_date: false,
        hint: "Run `domani update --yes` to upgrade non-interactively, or `domani update` in an interactive terminal.",
      });
      return;
    }

    s.stop(jsonMode ? "" : `New version available: ${pc.cyan(CLI_VERSION)} ${S.arrow} ${pc.green(latest)}`);

    const s2 = createSpinner(!jsonMode);
    s2.start("Downloading update");

    const dlUrl = `${apiUrl}/cli/domani.js`;
    const dlRes = await fetch(dlUrl);
    if (!dlRes.ok) {
      s2.stop("Download failed");
      fail(`Failed to download from ${dlUrl}`);
    }

    const bundle = await dlRes.text();

    // Verify integrity (SHA-256)
    if (expectedHash) {
      const actualHash = createHash("sha256").update(bundle).digest("hex");
      if (actualHash !== expectedHash) {
        s2.stop("Integrity check failed");
        fail("Downloaded file does not match expected hash - update aborted");
      }
    }

    // Find where the current binary lives
    const binPath = process.argv[1];
    if (!binPath) {
      s2.stop("Failed");
      fail("Could not determine binary path");
    }

    // Resolve symlinks to find actual file
    const realPath = fs.realpathSync(binPath);
    const tmpPath = realPath + ".tmp";

    // Write new version, then atomic rename
    fs.writeFileSync(tmpPath, bundle, { mode: 0o755 });
    fs.renameSync(tmpPath, realPath);

    s2.stop(`${S.success} Updated to v${latest}`);
    if (jsonMode) {
      jsonOut({ updated: true, from: CLI_VERSION, to: latest });
      return;
    }
    blank();
    console.log(`  ${pc.dim("Restart your terminal or run")} domani --version ${pc.dim("to verify")}`);
    blank();
  } catch (err) {
    fail(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
