import pc from "picocolors";
import { blank } from "./ui.js";
import type { ExitGuidance } from "./transfer-eligibility.js";

/**
 * Render a registrar exit playbook (options.transfer.guidance from the
 * adoption plan): where the transfer-lock toggle and the auth code live
 * at the losing registrar. Human output only - JSON consumers read the
 * field straight from the plan.
 */
export function renderExitGuidance(guidance: ExitGuidance | undefined | null): void {
  if (!guidance) return;
  blank();
  console.log(`  ${pc.bold(`Exit path (${guidance.managed_via})`)}`);
  console.log(`  ${pc.dim("Unlock:")}    ${guidance.unlock}`);
  console.log(`  ${pc.dim("Auth code:")} ${guidance.auth_code}`);
  for (const note of guidance.notes || []) {
    console.log(`  ${pc.yellow("!")} ${note}`);
  }
}
