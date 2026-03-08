import { createHash } from "crypto";
import fs from "fs";
import { getApiUrl, CLI_VERSION } from "../config.js";
import pc from "picocolors";
import { S, blank, createSpinner, fail } from "../ui.js";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function update(): Promise<void> {
  const s = createSpinner();
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
      return;
    }

    s.stop(`New version available: ${pc.cyan(CLI_VERSION)} ${S.arrow} ${pc.green(latest)}`);

    const s2 = createSpinner();
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
    blank();
    console.log(`  ${pc.dim("Restart your terminal or run")} domani --version ${pc.dim("to verify")}`);
    blank();
  } catch (err) {
    fail(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
