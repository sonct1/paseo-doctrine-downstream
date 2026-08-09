import { describe, expect, test } from "vitest";

import {
  PASEO_ROLE_CONTRACT_VERSION,
  PASEO_ROLE_IDS,
  ProviderRoleBindingSupportSchema,
  RoleBindingReceiptSchema,
} from "./role-binding.js";

describe("Paseo role binding protocol", () => {
  test("publishes the three Foundation roles under one contract version", () => {
    expect(PASEO_ROLE_IDS).toEqual(["lead", "peer", "supervisor"]);
    expect(PASEO_ROLE_CONTRACT_VERSION).toBe("3.3.0-mandatory-protocol-webui");
  });

  test("keeps supported and unsupported provider capability explicit", () => {
    expect(
      ProviderRoleBindingSupportSchema.parse({
        status: "supported",
        injectionMethod: "codex-developer-instructions",
      }),
    ).toEqual({
      status: "supported",
      injectionMethod: "codex-developer-instructions",
    });
    expect(
      ProviderRoleBindingSupportSchema.parse({
        status: "supported",
        injectionMethod: "mock-launch-context",
      }),
    ).toEqual({
      status: "supported",
      injectionMethod: "mock-launch-context",
    });
    expect(() => ProviderRoleBindingSupportSchema.parse({ status: "unsupported" })).toThrow();
    expect(() =>
      ProviderRoleBindingSupportSchema.parse({
        status: "candidate",
        injectionMethod: "cursor-always-apply-plugin",
        reason: "runtime canary required",
      }),
    ).toThrow();
  });

  test("role receipts contain no materialized instruction bytes", () => {
    const receipt = RoleBindingReceiptSchema.parse({
      roleId: "lead",
      definitionVersion: PASEO_ROLE_CONTRACT_VERSION,
      definitionDigest: "a".repeat(64),
      bindingDigest: "c".repeat(64),
      provider: "codex",
      injectionMethod: "codex-developer-instructions",
      qualification: "implementation-supported",
      workspaceProtocol: {
        status: "bound",
        readership: "full",
        path: "/repo/WORKSPACE_PROTOCOL.md",
        digest: "b".repeat(64),
      },
      createdAt: "2026-08-05T00:00:00.000Z",
      instructions: "must be stripped",
    });

    expect(receipt).not.toHaveProperty("instructions");
  });
});
