import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { ProviderLaunchBinding } from "./agent-sdk-types.js";
import {
  assertPersistedLaunchContractMatches,
  materializeLaunchContract,
  toLaunchContractReceipt,
} from "./launch-contract.js";
import { materializeRoleBinding } from "./role-binding.js";

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
  return await materializeRoleBinding({
    roleId: "lead",
    provider: "codex-proxy",
    providerBaseId: "codex",
    cwd,
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

  test("pins a private review specialization independently from its provider route", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "paseo-review-launch-contract-"));
    temporaryDirectories.push(cwd);
    const roleBinding = await materializeRoleBinding({
      roleId: "peer",
      executionProfileId: "review",
      provider: "claude",
      cwd,
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    const contract = materializeLaunchContract(roleBinding, {
      providerId: "claude",
      providerFamily: "claude",
      model: "claude-opus-5",
      credentialConfigured: null,
      routeKind: "provider-native",
      modelProviderId: null,
      authMethod: "provider-native",
    });

    expect(contract.roleBinding.executionProfile?.id).toBe("review");
    expect(contract.receipt).toMatchObject({
      roleId: "peer",
      providerId: "claude",
      providerFamily: "claude",
      model: "claude-opus-5",
    });

    const drifted = {
      ...contract,
      roleBinding: {
        ...contract.roleBinding,
        executionProfile: {
          ...contract.roleBinding.executionProfile!,
          version: "drifted-review-version",
        },
      },
    };
    expect(() =>
      assertPersistedLaunchContractMatches(drifted, {
        provider: "claude",
        model: "claude-opus-5",
        cwd,
      }),
    ).toThrow("receipt does not match");
  });
});
