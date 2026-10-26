import fs from "fs";
import path from "path";
import os from "os";
import { confirm as clackConfirm } from "@clack/prompts";
import pc from "picocolors";
import { S, blank } from "../ui.js";
import { listAccounts } from "../config.js";
import { keychainDelete } from "../keychain.js";

export async function uninstall(): Promise<void> {
  const binPath = process.argv[1];
  const realPath = binPath ? fs.realpathSync(binPath) : null;
  const configDir = path.join(os.homedir(), ".domani");

  blank();
  console.log(`  ${pc.bold("This will remove:")}`);
  if (realPath) console.log(`  ${S.dot} CLI binary: ${pc.dim(realPath)}`);
  console.log(`  ${S.dot} Config dir: ${pc.dim(configDir)}`);
  blank();

  const ok = await clackConfirm({ message: "Uninstall domani?" });
  if (ok !== true) {
    console.log(`  ${pc.dim("Cancelled.")}`);
    return;
  }

  // Remove every saved login's keychain entry, then the config directory
  for (const account of listAccounts()) {
    if (account.token_in_keychain) keychainDelete(account.name);
  }
  fs.rmSync(configDir, { recursive: true, force: true });

  // Remove binary
  if (realPath) {
    fs.unlinkSync(realPath);
  }

  blank();
  console.log(`  ${S.success} domani uninstalled.`);
  blank();
}
