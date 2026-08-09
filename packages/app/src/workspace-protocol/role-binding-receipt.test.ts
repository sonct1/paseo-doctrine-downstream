import { describe, expect, test } from "vitest";
import { formatRoleBindingReceiptDescription } from "./role-binding-receipt";

describe("role binding receipt description", () => {
  test("shows immutable binding and protocol provenance without instruction bytes", () => {
    const description = formatRoleBindingReceiptDescription("Lead summary", {
      roleId: "lead",
      definitionVersion: "3.3.0-mandatory-protocol-webui",
      definitionDigest: "a".repeat(64),
      bindingDigest: "b".repeat(64),
      provider: "codex",
      injectionMethod: "codex-developer-instructions",
      qualification: "implementation-supported",
      workspaceProtocol: {
        status: "bound",
        readership: "full",
        path: "/repo/WORKSPACE_PROTOCOL.md",
        digest: "c".repeat(64),
      },
      createdAt: "2026-08-08T00:00:00.000Z",
    });

    expect(description).toContain("Contract: 3.3.0-mandatory-protocol-webui");
    expect(description).toContain(`Binding: sha256:${"b".repeat(64)}`);
    expect(description).toContain(`Protocol: bound · full · sha256:${"c".repeat(64)}`);
    expect(description).not.toContain("Role: Lead");
  });
});
