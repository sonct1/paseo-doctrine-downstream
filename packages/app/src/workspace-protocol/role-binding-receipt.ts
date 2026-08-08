import type { RoleBindingReceipt } from "@getpaseo/protocol/role-binding";

export function formatRoleBindingReceiptDescription(
  summary: string | undefined,
  receipt: RoleBindingReceipt,
): string {
  const protocolDigest = receipt.workspaceProtocol.digest ?? "none";
  return [
    summary,
    `Contract: ${receipt.definitionVersion}`,
    `Binding: sha256:${receipt.bindingDigest}`,
    `Protocol: ${receipt.workspaceProtocol.status} · ${receipt.workspaceProtocol.readership} · sha256:${protocolDigest}`,
    `Injection: ${receipt.injectionMethod}`,
    `Created: ${receipt.createdAt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
