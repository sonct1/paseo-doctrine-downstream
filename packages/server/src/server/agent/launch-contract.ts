import { createHash } from "node:crypto";
import {
  LaunchContractReceiptSchema,
  PASEO_LAUNCH_CONTRACT_VERSION,
  type LaunchContractReceipt,
} from "@getpaseo/protocol/launch-contract";
import { z } from "zod";
import type { AgentSessionConfig, ProviderLaunchBinding } from "./agent-sdk-types.js";
import {
  PersistedRoleBindingSchema,
  policyOwnerForRoleBinding,
  type PersistedRoleBinding,
} from "./role-binding.js";

const ProviderLaunchBindingSchema = z.discriminatedUnion("routeKind", [
  z.object({
    providerId: z.string().min(1),
    providerFamily: z.literal("codex"),
    model: z.string().min(1),
    credentialConfigured: z.literal(true),
    routeKind: z.literal("codex-subscription"),
    modelProviderId: z.literal("openai"),
    authMethod: z.literal("codex-native"),
  }),
  z.object({
    providerId: z.string().min(1),
    providerFamily: z.literal("codex"),
    model: z.string().min(1),
    credentialConfigured: z.literal(true),
    routeKind: z.literal("openai-compatible"),
    modelProviderId: z.string().min(1),
    authMethod: z.literal("credential-command"),
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const parsed = new URL(value);
        return (
          parsed.protocol === "https:" &&
          !parsed.username &&
          !parsed.password &&
          !parsed.search &&
          !parsed.hash &&
          parsed.pathname.replace(/\/+$/u, "").endsWith("/v1")
        );
      }, "OpenAI-compatible base URL must be an HTTPS /v1 endpoint without embedded credentials, query, or fragment"),
    credentialRef: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    credentialFile: z.string().min(1),
  }),
  z.object({
    providerId: z.string().min(1),
    providerFamily: z.string().min(1),
    model: z.string().min(1),
    credentialConfigured: z.null(),
    routeKind: z.literal("provider-native"),
    modelProviderId: z.null(),
    authMethod: z.literal("provider-native"),
  }),
]) satisfies z.ZodType<ProviderLaunchBinding>;

export const PersistedLaunchContractSchema = z.object({
  receipt: LaunchContractReceiptSchema,
  roleBinding: PersistedRoleBindingSchema,
  providerBinding: ProviderLaunchBindingSchema,
});

export type PersistedLaunchContract = z.infer<typeof PersistedLaunchContractSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalContractBytes(
  roleBinding: PersistedRoleBinding,
  providerBinding: ProviderLaunchBinding,
): string {
  const policyOwner = policyOwnerForRoleBinding(roleBinding);
  return JSON.stringify({
    // COMPAT(policyOwner): legacy-core bindings preserve their existing launch-contract digest.
    ...(policyOwner.kind === "plugin" ? { policyOwner } : {}),
    roleId: roleBinding.roleId,
    roleDefinitionVersion: roleBinding.definitionVersion,
    roleDefinitionDigest: roleBinding.definitionDigest,
    roleBindingDigest: roleBinding.bindingDigest,
    // COMPAT(privateExecutionProfile): preserves existing launch-contract digests.
    executionProfile: roleBinding.executionProfile ?? null,
    // COMPAT(roleProfiles): omit for legacy bindings so their contract digests remain stable.
    ...(roleBinding.roleProfile ? { roleProfile: roleBinding.roleProfile } : {}),
    roleInstructions: roleBinding.instructions,
    providerBinding,
  });
}

export function materializeLaunchContract(
  roleBinding: PersistedRoleBinding,
  providerBinding: ProviderLaunchBinding,
): PersistedLaunchContract {
  const receipt: LaunchContractReceipt = {
    version: PASEO_LAUNCH_CONTRACT_VERSION,
    contractDigest: sha256(canonicalContractBytes(roleBinding, providerBinding)),
    roleId: roleBinding.roleId,
    providerId: providerBinding.providerId,
    providerFamily: providerBinding.providerFamily,
    model: providerBinding.model,
    routeKind: providerBinding.routeKind,
    modelProviderId: providerBinding.modelProviderId,
    authMethod: providerBinding.authMethod,
    credentialConfigured: providerBinding.credentialConfigured,
    createdAt: roleBinding.createdAt,
  };
  return PersistedLaunchContractSchema.parse({ receipt, roleBinding, providerBinding });
}

export function toLaunchContractReceipt(contract: PersistedLaunchContract): LaunchContractReceipt {
  return contract.receipt;
}

export function assertPersistedLaunchContractMatches(
  contract: PersistedLaunchContract,
  config: AgentSessionConfig,
): void {
  PersistedLaunchContractSchema.parse(contract);
  const expectedReceipt = materializeLaunchContract(
    contract.roleBinding,
    contract.providerBinding,
  ).receipt;
  if (JSON.stringify(contract.receipt) !== JSON.stringify(expectedReceipt)) {
    throw new Error("Persisted launch contract receipt does not match its materialized bytes");
  }
  if (contract.receipt.providerId !== config.provider) {
    throw new Error(
      `Launch contract provider '${contract.receipt.providerId}' does not match session provider '${config.provider}'`,
    );
  }
  if (contract.receipt.model !== config.model) {
    throw new Error(
      `Launch contract model '${contract.receipt.model}' does not match session model '${config.model ?? "<missing>"}'`,
    );
  }
}
