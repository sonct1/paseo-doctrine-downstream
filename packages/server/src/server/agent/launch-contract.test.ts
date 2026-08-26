import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { ProviderLaunchBinding } from "./agent-sdk-types.js";
import {
  assertPersistedLaunchContractMatches,
  materializeLaunchContract,
  toLaunchContractReceipt,
} from "./launch-contract.js";
import { materializeRoleBinding } from "./legacy-role-binding.js";
import { buildWorkspaceProtocolTemplate } from "../../utils/workspace-protocol-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRoleBinding() {
  const cwd = await mkdtemp(join(tmpdir(), "paseo-launch-contract-"));
  temporaryDirectories.push(cwd);
  await writeFile(join(cwd, "WORKSPACE_PROTOCOL.md"), buildWorkspaceProtocolTemplate(cwd), "utf8");
  return await materializeRoleBinding({
    roleId: "lead",
    provider: "codex-proxy",
    providerBaseId: "codex",
    cwd,
    workspaceId: `workspace:${cwd}`,
    assignmentAssigner: { kind: "human-session" },
    assignment: {
      version: 1,
      disposition: "lead-direct",
      objective: "Inspect the exact launch binding.",
      effectClass: "read-only",
      mutationBoundary: { mode: "no-write" },
      externalEffectBoundary: { mode: "denied" },
      evidence: "Return the immutable receipt.",
      handbackAndStop: "Stop after receipt verification.",
    },
    createdAt: new Date("2026-08-06T00:00:00.000Z"),
  });
}

describe("immutable launch contract", () => {
  test("persists an exact custom route but exposes only a secret-safe receipt", async () => {
    const roleBinding = await createRoleBinding();
    const contract = materializeLaunchContract(roleBinding, {
      providerId: "codex-proxy",
      providerFamily: "codex",
      model: "custom-model",
      credentialConfigured: true,
      routeKind: "openai-compatible",
      modelProviderId: "codex-proxy",
      authMethod: "credential-command",
      baseUrl: "https://proxy.example/v1",
      credentialRef: "codex-proxy",
      credentialFile: "/private/paseo/credentials/codex-proxy.json",
    });

    expect(() =>
      assertPersistedLaunchContractMatches(contract, {
        provider: "codex-proxy",
        model: "custom-model",
        cwd: roleBinding.workspaceProtocol.path,
      }),
    ).not.toThrow();
    expect(toLaunchContractReceipt(contract)).toMatchObject({
      roleId: "lead",
      providerId: "codex-proxy",
      model: "custom-model",
      credentialConfigured: true,
    });
    expect(toLaunchContractReceipt(contract)).not.toHaveProperty("credentialRef");
    expect(toLaunchContractReceipt(contract)).not.toHaveProperty("credentialFile");
    expect(toLaunchContractReceipt(contract)).not.toHaveProperty("baseUrl");
  });

  test("rejects contract receipt drift and unsafe persisted custom URLs", async () => {
    const roleBinding = await createRoleBinding();
    const providerBinding: ProviderLaunchBinding = {
      providerId: "codex-proxy",
      providerFamily: "codex",
      model: "custom-model",
      credentialConfigured: true,
      routeKind: "openai-compatible",
      modelProviderId: "codex-proxy",
      authMethod: "credential-command",
      baseUrl: "https://proxy.example/v1",
      credentialRef: "codex-proxy",
      credentialFile: "/private/paseo/credentials/codex-proxy.json",
    };
    const contract = materializeLaunchContract(roleBinding, providerBinding);
    const drifted = {
      ...contract,
      receipt: { ...contract.receipt, model: "other-model" },
    };
    expect(() =>
      assertPersistedLaunchContractMatches(drifted, {
        provider: "codex-proxy",
        model: "other-model",
        cwd: roleBinding.workspaceProtocol.path,
      }),
    ).toThrow("receipt does not match");

    expect(() =>
      materializeLaunchContract(roleBinding, {
        ...providerBinding,
        baseUrl: "http://proxy.example/v1",
      }),
    ).toThrow("HTTPS /v1 endpoint");
  });

  test("preserves legacy digests while pinning plugin-owned generations", async () => {
    const roleBinding = await createRoleBinding();
    const providerBinding: ProviderLaunchBinding = {
      providerId: "codex-proxy",
      providerFamily: "codex",
      model: "custom-model",
      credentialConfigured: true,
      routeKind: "openai-compatible",
      modelProviderId: "codex-proxy",
      authMethod: "credential-command",
      baseUrl: "https://proxy.example/v1",
      credentialRef: "codex-proxy",
      credentialFile: "/private/paseo/credentials/codex-proxy.json",
    };
    const explicitLegacy = materializeLaunchContract(roleBinding, providerBinding);
    const { policyOwner: _policyOwner, ...preOwnerBinding } = roleBinding;
    const implicitLegacy = materializeLaunchContract(preOwnerBinding, providerBinding);
    expect(implicitLegacy.receipt.contractDigest).toBe(explicitLegacy.receipt.contractDigest);

    const pluginOwned = materializeLaunchContract(
      {
        ...roleBinding,
        policyOwner: {
          kind: "plugin",
          pluginId: "slp",
          generationDigest: "a".repeat(64),
          policyVersion: "1.0.0",
        },
      },
      providerBinding,
    );
    expect(pluginOwned.receipt.contractDigest).not.toBe(explicitLegacy.receipt.contractDigest);

    const driftedGeneration = {
      ...pluginOwned,
      roleBinding: {
        ...pluginOwned.roleBinding,
        policyOwner: {
          kind: "plugin" as const,
          pluginId: "slp",
          generationDigest: "b".repeat(64),
          policyVersion: "1.0.0",
        },
      },
    };
    expect(() =>
      assertPersistedLaunchContractMatches(driftedGeneration, {
        provider: "codex-proxy",
        model: "custom-model",
        cwd: roleBinding.workspaceProtocol.path,
      }),
    ).toThrow("receipt does not match");
  });

  test("pins a Council specialization independently from its provider route", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "paseo-council-launch-contract-"));
    temporaryDirectories.push(cwd);
    await writeFile(
      join(cwd, "WORKSPACE_PROTOCOL.md"),
      buildWorkspaceProtocolTemplate(cwd),
      "utf8",
    );
    const roleBinding = await materializeRoleBinding({
      roleId: "peer",
      executionProfileId: "reviewer",
      provider: "claude",
      cwd,
      workspaceId: `workspace:${cwd}`,
      assignmentAssigner: { kind: "human-session" },
      assignment: {
        version: 1,
        disposition: "independent-review",
        objective: "Review one frozen Council proposition.",
        effectClass: "read-only",
        mutationBoundary: { mode: "no-write" },
        externalEffectBoundary: { mode: "denied" },
        resourceGrants: { beadsIssueIds: ["ps-council-contract"] },
        evidence: "Return direct observations and material findings.",
        handbackAndStop: "Stop after the bounded report.",
      },
      createdAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    const contract = materializeLaunchContract(roleBinding, {
      providerId: "claude",
      providerFamily: "claude",
      model: "claude-opus-current",
      credentialConfigured: null,
      routeKind: "provider-native",
      modelProviderId: null,
      authMethod: "provider-native",
    });

    expect(contract.roleBinding.executionProfile?.id).toBe("reviewer");
    expect(contract.receipt).toMatchObject({
      roleId: "peer",
      providerId: "claude",
      model: "claude-opus-current",
    });

    const drifted = {
      ...contract,
      roleBinding: {
        ...contract.roleBinding,
        executionProfile: {
          ...contract.roleBinding.executionProfile!,
          version: "drifted-reviewer-version",
        },
      },
    };
    expect(() =>
      assertPersistedLaunchContractMatches(drifted, {
        provider: "claude",
        model: "claude-opus-current",
        cwd,
      }),
    ).toThrow("receipt does not match");
  });
});
