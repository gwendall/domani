import { build } from "esbuild";
import { createHash } from "crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";

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

// Copy bundle to public/cli/ for download via domani.run/cli/domani.js
const publicDir = "../public/cli";
mkdirSync(publicDir, { recursive: true });
copyFileSync("dist/domani.cjs", `${publicDir}/domani.js`);

// Generate SHA-256 hash for integrity verification
const bundle = readFileSync("dist/domani.cjs");
const sha256 = createHash("sha256").update(bundle).digest("hex");

// Write hash to version.json (served by /api/cli/version)
writeFileSync("version.json", JSON.stringify({ ...versionData, sha256 }, null, 2) + "\n");

// Write hash sidecar (for install.sh verification)
writeFileSync(`${publicDir}/domani.js.sha256`, `${sha256}  domani.js\n`);
