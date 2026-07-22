import pc from "picocolors";
import { apiRequest } from "../api.js";
import { S, blank, createSpinner, fail, fmt, heading, hintCommand, jsonOut, openUrl, row, table } from "../ui.js";

interface WorkspaceOptions {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  mailboxes?: string;
  mailboxRole?: string;
  token?: string;
  plan?: string;
  open?: boolean;
  json?: boolean;
  fields?: string;
  membershipId?: string;
  transferId?: string;
  mailboxId?: string;
}

async function request(path: string, options: RequestInit | undefined, config: WorkspaceOptions, label: string) {
  const spinner = createSpinner(!config.json);
  spinner.start(label);
  const response = await apiRequest(path, options);
  const data = await response.json();
  if (!response.ok) {
    spinner.stop("Failed");
    fail(data.error || data.message, {
      hint: data.hint,
      status: response.status,
      json: config.json,
      fields: config.fields,
    });
  }
  spinner.stop(`${S.success} Done`);
  return data;
}

export async function workspace(action: string | undefined, options: WorkspaceOptions): Promise<void> {
  if (!action || action === "list") {
    const data = await request("/api/workspaces", undefined, options, "Loading workspaces");
    if (options.json) return jsonOut(data, options.fields);
    blank();
    heading("Workspaces");
    if (!data.workspaces.length) {
      console.log(`  ${pc.dim("No workspaces yet.")}`);
      hintCommand("Create one:", "domani workspace create --name Acme");
      return;
    }
    table(["ID", "Name", "Role", "Mailboxes", "Members"], data.workspaces.map((item: {
      id: string; name: string; role: string; mailbox_count: number; member_count: number;
    }) => [item.id, item.name, item.role, String(item.mailbox_count), String(item.member_count)]), [28, 28, 10, 10, 8]);
    blank();
    return;
  }

  if (action === "create") {
    if (!options.name) fail("Workspace name required", { hint: "Usage: domani workspace create --name Acme", code: "validation_error", json: options.json });
    const data = await request("/api/workspaces", { method: "POST", body: JSON.stringify({ name: options.name }) }, options, "Creating workspace");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Workspace Created"); row("ID", data.id); row("Name", data.name); blank();
    return;
  }

  if (action === "show") {
    if (!options.id) fail("Workspace ID required", { hint: "Usage: domani workspace show --id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}`, undefined, options, "Loading workspace");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading(data.name); row("Role", data.role); row("Mailboxes", data.mailboxes.length); row("Members", data.members.length); blank();
    table(["Email", "Role", "Mailbox grants"], data.members.map((member: { email: string; role: string; mailbox_grants: unknown[] }) => [member.email, member.role, String(member.mailbox_grants.length)]), [42, 12, 16]);
    blank();
    return;
  }

  if (action === "invite") {
    if (!options.id || !options.email) fail("Workspace ID and email required", { hint: "Usage: domani workspace invite --id <id> --email person@example.com", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/invitations`, {
      method: "POST",
      body: JSON.stringify({
        email: options.email,
        role: options.role,
        mailbox_ids: options.mailboxes?.split(",").map((value) => value.trim()).filter(Boolean),
        mailbox_role: options.mailboxRole,
      }),
    }, options, "Sending invitation");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Invitation Sent"); row("Email", data.email); row("Role", data.role); row("Expires", data.expires_at); blank();
    return;
  }

  if (action === "accept") {
    if (!options.token) fail("Invitation token required", { hint: "Usage: domani workspace accept --token <token>", code: "validation_error", json: options.json });
    const data = await request("/api/workspaces/invitations/accept", { method: "POST", body: JSON.stringify({ token: options.token }) }, options, "Accepting invitation");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Workspace Joined"); row("Workspace", data.workspace_name); row("Role", data.role); blank();
    return;
  }

  if (action === "transfer") {
    if (!options.id || !options.membershipId) fail("Workspace ID and target membership ID required", { hint: "Usage: domani workspace transfer --id <workspace-id> --membership-id <membership-id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/ownership-transfer`, {
      method: "POST",
      body: JSON.stringify({ membership_id: options.membershipId }),
    }, options, "Requesting ownership transfer");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Ownership Transfer Requested"); row("To", data.to_email); row("Expires", data.expires_at); row("Billing", data.billing); blank();
    return;
  }

  if (action === "accept-ownership") {
    if (!options.token) fail("Ownership transfer token required", { hint: "Usage: domani workspace accept-ownership --token <token>", code: "validation_error", json: options.json });
    const data = await request("/api/workspaces/ownership-transfers/accept", { method: "POST", body: JSON.stringify({ token: options.token }) }, options, "Accepting ownership");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Ownership Transferred"); row("Workspace", data.workspace_id); row("Domains", data.domains_transferred); row("Mailboxes", data.mailboxes_transferred); row("Previous owner", data.previous_owner_role); blank();
    return;
  }

  if (action === "revoke-transfer") {
    if (!options.id || !options.transferId) fail("Workspace ID and transfer ID required", { hint: "Usage: domani workspace revoke-transfer --id <workspace-id> --transfer-id <transfer-id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/ownership-transfer/${encodeURIComponent(options.transferId)}`, { method: "DELETE" }, options, "Revoking ownership transfer");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Ownership Transfer Revoked"); row("Transfer", data.transfer_id); blank();
    return;
  }

  if (action === "adopt-mailbox") {
    if (!options.id || !options.mailboxId) fail("Workspace ID and mailbox ID required", { hint: "Usage: domani workspace adopt-mailbox --id <workspace-id> --mailbox-id <mailbox-id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/mailboxes`, { method: "POST", body: JSON.stringify({ mailbox_id: options.mailboxId }) }, options, "Adopting mailbox boundary");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading(data.adopted ? "Mailbox Boundary Adopted" : "Already in Workspace"); row("Address", data.address); row("Mailboxes", data.mailbox_ids?.length ?? 1); blank();
    return;
  }

  if (action === "checkout") {
    if (!options.id || !options.plan) fail("Workspace ID and plan required", { hint: "Usage: domani workspace checkout --id <id> --plan mail_team", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/billing/checkout`, {
      method: "POST",
      body: JSON.stringify({ plan: options.plan }),
    }, options, "Creating secure checkout");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Workspace Checkout"); row("Plan", data.plan); row("URL", data.url); blank();
    if (data.url && options.open !== false) {
      console.log(`  ${pc.dim("Opening browser")} ${S.arrow} ${fmt.url(data.url)}`);
      openUrl(data.url);
    }
    return;
  }

  if (action === "cancel") {
    if (!options.id) fail("Workspace ID required", { hint: "Usage: domani workspace cancel --id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/billing/cancel`, { method: "POST" }, options, "Scheduling cancellation");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Cancellation Scheduled"); row("Message", data.message); if (data.cancel_at) row("Cancels", data.cancel_at); blank();
    return;
  }

  fail(`Unknown action: ${action}`, {
    hint: "Actions: list, create, show, invite, accept, transfer, accept-ownership, revoke-transfer, adopt-mailbox, checkout, cancel",
    code: "validation_error",
    json: options.json,
    fields: options.fields,
  });
}
