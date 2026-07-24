import { build } from "esbuild";
import { createHash } from "crypto";
import { chmodSync, readFileSync, writeFileSync } from "fs";

const versionData = JSON.parse(readFileSync("version.json", "utf-8"));

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "dist/domani.cjs",
  banner: { js: "#!/usr/bin/env node" },
  minify: true,
  define: { __CLI_VERSION__: JSON.stringify(versionData.version) },
});

// esbuild creates output files with the process umask. Keep the published CLI
// directly executable on every platform and make the copied web artifact
// reproducible between macOS and Linux.
chmodSync("dist/domani.cjs", 0o755);

// Generate SHA-256 hash for integrity verification
const bundle = readFileSync("dist/domani.cjs");
const sha256 = createHash("sha256").update(bundle).digest("hex");

// Write hash to version.json (served by /api/cli/version)
writeFileSync("version.json", JSON.stringify({ ...versionData, sha256 }, null, 2) + "\n");
