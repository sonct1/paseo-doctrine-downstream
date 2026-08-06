import { describe, expect, it } from "vitest";
import { LaunchContractReceiptSchema } from "./launch-contract.js";

describe("LaunchContractReceiptSchema", () => {
  it("accepts a redacted custom Codex receipt", () => {
    const receipt = LaunchContractReceiptSchema.parse({
      version: 1,
      contractDigest: "a".repeat(64),
      roleId: "lead",
      providerId: "codex-proxy",
      providerFamily: "codex",
      model: "custom-coder",
      routeKind: "openai-compatible",
      modelProviderId: "codex-proxy",
      authMethod: "credential-command",
      credentialConfigured: true,
      createdAt: "2026-08-06T00:00:00.000Z",
    });

    expect(receipt).not.toHaveProperty("credentialRef");
  });

  it("rejects a malformed contract digest", () => {
    expect(() =>
      LaunchContractReceiptSchema.parse({
        version: 1,
        contractDigest: "not-a-digest",
        roleId: "lead",
        providerId: "codex",
        providerFamily: "codex",
        model: "gpt-test",
        routeKind: "codex-subscription",
        modelProviderId: "openai",
        authMethod: "codex-native",
        credentialConfigured: true,
        createdAt: "2026-08-06T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
