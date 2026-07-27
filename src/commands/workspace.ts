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
  invitationId?: string;
  transferId?: string;
  mailboxId?: string;
  subject?: string;
  resource?: string;
  profile?: string;
  principals?: string;
  groupId?: string;
  collectionId?: string;
  apply?: boolean;
  expectedVersion?: string;
  grantId?: string;
  ownershipDisposition?: string;
  creatorDisposition?: string;
  billingDisposition?: string;
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

  if (action === "access") {
    if (!options.id) fail("Workspace ID required", { hint: "Usage: domani workspace access --id <id>", code: "validation_error", json: options.json });
    if (!options.subject && !options.resource && !options.profile) {
      const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/access`, undefined, options, "Loading access graph");
      if (options.json) return jsonOut(data, options.fields);
      blank(); heading("Access Graph");
      row("Principals", data.principals.length); row("Mailboxes", data.mailboxes.length);
      row("Groups", data.groups.length); row("Collections", data.collections.length);
      row("Active grants", data.grants.length); row("Pending offers", data.offers.length); blank();
      return;
    }
    if (!options.subject || !options.resource || !options.profile) {
      fail("Subject, resource, and profile are required together", {
        hint: "Usage: domani workspace access --id <id> --subject human:<id> --resource mailbox:<id> --profile responder [--apply]",
        code: "validation_error",
        json: options.json,
      });
    }
    const [subjectType, subjectId] = options.subject.split(":", 2);
    const [resourceType, resourceId] = options.resource.split(":", 2);
    if (!subjectId || !["human", "agent", "service", "token", "group"].includes(subjectType)) fail("Invalid --subject", { hint: "Use human:<id>, agent:<id>, service:<id>, token:<id>, or group:<id>", json: options.json });
    if (!resourceId || !["mailbox", "collection"].includes(resourceType)) fail("Invalid --resource", { hint: "Use mailbox:<id> or collection:<id>", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/access`, {
      method: "PUT",
      body: JSON.stringify({
        mode: options.apply ? "apply" : "plan",
        subject: subjectType === "group"
          ? { type: "group", id: subjectId }
          : { type: "principal", principal: { type: subjectType, id: subjectId } },
        resource: { type: resourceType, id: resourceId },
        profile: options.profile,
        expected_version: options.expectedVersion ? Number(options.expectedVersion) : undefined,
      }),
    }, options, options.apply ? "Applying access" : "Planning access");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading(options.apply ? "Access Applied" : "Access Plan");
    row("Action", data.action); row("Changed", String(data.changed)); if (data.grant_id) row("Grant", data.grant_id); blank();
    return;
  }

  if (action === "group") {
    if (!options.id || !options.name) fail("Workspace ID and group name required", { hint: "Usage: domani workspace group --id <id> --name Support --principals human:u1,agent:a1", code: "validation_error", json: options.json });
    const principals = (options.principals || "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
      const [type, id] = value.split(":", 2);
      if (!id) fail(`Invalid principal: ${value}`, { hint: "Use type:id", json: options.json });
      return { type, id, label: id };
    });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/access/groups`, {
      method: "PUT",
      body: JSON.stringify({ id: options.groupId, name: options.name, principals }),
    }, options, "Syncing access group");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Access Group Synced"); row("ID", data.id); row("Principals", data.principal_count); blank();
    return;
  }

  if (action === "collection") {
    if (!options.id || !options.name) fail("Workspace ID and collection name required", { hint: "Usage: domani workspace collection --id <id> --name Admin --mailboxes mb1,mb2", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/access/collections`, {
      method: "PUT",
      body: JSON.stringify({
        id: options.collectionId,
        name: options.name,
        mailbox_ids: options.mailboxes?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
      }),
    }, options, "Syncing mailbox collection");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Mailbox Collection Synced"); row("ID", data.id); row("Mailboxes", data.mailbox_count); blank();
    return;
  }

  if (action === "offer") {
    if (!options.id || !options.email) fail("Workspace ID and recipient email required", { hint: "Usage: domani workspace offer --id <id> --email person@example.com --mailboxes mb1,mb2 --profile responder", code: "validation_error", json: options.json });
    const grants = (options.mailboxes || "").split(",").map((value) => value.trim()).filter(Boolean).map((id) => ({
      resource: { type: "mailbox", id },
      profile: options.profile || "responder",
    }));
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/access/offers`, {
      method: "POST",
      body: JSON.stringify({
        email: options.email,
        grants,
        ownership_disposition: options.ownershipDisposition,
        creator_disposition: options.creatorDisposition,
        billing_disposition: options.billingDisposition,
      }),
    }, options, "Sending access offer");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Access Offered"); row("Email", data.email); row("Expires", data.expires_at); blank();
    return;
  }

  if (action === "accept-offer") {
    if (!options.token) fail("Access offer token required", { hint: "Usage: domani workspace accept-offer --token <token>", code: "validation_error", json: options.json });
    const data = await request("/api/workspaces/access/offers/accept", {
      method: "POST",
      body: JSON.stringify({ token: options.token }),
    }, options, "Accepting access offer");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Access Accepted"); row("Workspace", data.workspace_name); row("Ownership", data.ownership); blank();
    return;
  }

  if (action === "revoke-access") {
    if (!options.id || !options.grantId) fail("Workspace and grant IDs required", { hint: "Usage: domani workspace revoke-access --id <id> --grant-id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/access/grants/${encodeURIComponent(options.grantId)}`, {
      method: "DELETE",
      body: JSON.stringify({ expected_version: options.expectedVersion ? Number(options.expectedVersion) : undefined }),
    }, options, "Revoking access");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Access Revoked"); row("Grant", data.grant_id); row("Version", data.version); blank();
    return;
  }

  if (action === "rename") {
    if (!options.id || !options.name) fail("Workspace ID and name required", { hint: "Usage: domani workspace rename --id <id> --name <name>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}`, { method: "PATCH", body: JSON.stringify({ name: options.name }) }, options, "Renaming workspace");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Workspace Renamed"); row("ID", data.id); row("Name", data.name); blank();
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

  if (action === "revoke-invite") {
    if (!options.id || !options.invitationId) fail("Workspace ID and invitation ID required", { hint: "Usage: domani workspace revoke-invite --id <id> --invitation-id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/invitations/${encodeURIComponent(options.invitationId)}`, { method: "DELETE" }, options, "Revoking invitation");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Invitation Revoked"); row("Invitation", data.invitation_id); blank();
    return;
  }

  if (action === "member-role") {
    if (!options.id || !options.membershipId || !options.role) fail("Workspace ID, membership ID, and role required", { hint: "Usage: domani workspace member-role --id <id> --membership-id <id> --role admin|member", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/members/${encodeURIComponent(options.membershipId)}`, { method: "PATCH", body: JSON.stringify({ role: options.role }) }, options, "Updating member role");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Member Updated"); row("Membership", data.id); row("Role", data.role); blank();
    return;
  }

  if (action === "remove-member") {
    if (!options.id || !options.membershipId) fail("Workspace ID and membership ID required", { hint: "Usage: domani workspace remove-member --id <id> --membership-id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/members/${encodeURIComponent(options.membershipId)}`, { method: "DELETE" }, options, "Removing member and revoking access");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Member Removed"); row("Membership", data.membership_id); blank();
    return;
  }

  if (action === "leave") {
    if (!options.id) fail("Workspace ID required", { hint: "Usage: domani workspace leave --id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/members/me`, { method: "DELETE" }, options, "Leaving workspace and revoking access");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Workspace Left"); row("Workspace", data.workspace_id); blank();
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

  if (action === "grant") {
    if (!options.id || !options.mailboxId || !options.membershipId || !options.role) fail("Workspace, mailbox, membership, and role required", { hint: "Usage: domani workspace grant --id <id> --mailbox-id <id> --membership-id <id> --role viewer|responder|manager", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/mailboxes/${encodeURIComponent(options.mailboxId)}/grants`, { method: "PUT", body: JSON.stringify({ membership_id: options.membershipId, role: options.role }) }, options, "Granting mailbox access");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Mailbox Access Granted"); row("Membership", data.membership_id); row("Mailbox", data.mailbox_id); row("Role", data.role); blank();
    return;
  }

  if (action === "revoke-grant") {
    if (!options.id || !options.mailboxId || !options.membershipId) fail("Workspace, mailbox, and membership required", { hint: "Usage: domani workspace revoke-grant --id <id> --mailbox-id <id> --membership-id <id>", code: "validation_error", json: options.json });
    const data = await request(`/api/workspaces/${encodeURIComponent(options.id)}/mailboxes/${encodeURIComponent(options.mailboxId)}/grants`, { method: "DELETE", body: JSON.stringify({ membership_id: options.membershipId }) }, options, "Revoking mailbox access");
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("Mailbox Access Revoked"); row("Membership", data.membership_id); row("Mailbox", data.mailbox_id); blank();
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
    hint: "Actions: list, create, show, access, group, collection, offer, accept-offer, revoke-access, rename, invite, accept, revoke-invite, member-role, remove-member, leave, transfer, accept-ownership, revoke-transfer, adopt-mailbox, grant, revoke-grant, checkout, cancel",
    code: "validation_error",
    json: options.json,
    fields: options.fields,
  });
}
