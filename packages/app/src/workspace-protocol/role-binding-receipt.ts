import type { RoleBindingReceipt } from "@getpaseo/protocol/role-binding";
import { formatAssignmentAuthorityReceipt } from "./assignment-authority";

function formatPolicyOwner(receipt: RoleBindingReceipt): string {
  const owner = receipt.policyOwner;
  if (!owner || owner.kind === "legacy-core") return "legacy-core";
  return `plugin:${owner.pluginId}@sha256:${owner.generationDigest} · ${owner.policyVersion}`;
}

export function formatRoleBindingReceiptDescription(
  summary: string | undefined,
  receipt: RoleBindingReceipt,
): string {
  const protocolDigest = receipt.workspaceProtocol.digest ?? "none";
  return [
    summary,
    `Contract: ${receipt.definitionVersion}`,
    `Policy owner: ${formatPolicyOwner(receipt)}`,
    `Binding: sha256:${receipt.bindingDigest}`,
    `Protocol: ${receipt.workspaceProtocol.status} · ${receipt.workspaceProtocol.readership} · sha256:${protocolDigest}`,
    `Injection: ${receipt.injectionMethod}`,
    ...(receipt.assignment ? formatAssignmentAuthorityReceipt(receipt.assignment) : []),
    `Created: ${receipt.createdAt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
