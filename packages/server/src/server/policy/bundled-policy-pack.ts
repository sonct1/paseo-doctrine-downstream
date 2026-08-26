import { createHash } from "node:crypto";
import { PolicyOwnerSchema, type PolicyOwner } from "@getpaseo/protocol/policy-owner";
import { z } from "zod";

export const BUNDLED_POLICY_PACK_ABI_VERSION = 1 as const;
export const SLP_BUNDLED_POLICY_PLUGIN_ID = "slp" as const;

const RESERVED_BUNDLED_POLICY_PLUGIN_IDS = new Set<string>([SLP_BUNDLED_POLICY_PLUGIN_ID]);

export const BundledPolicyPackManifestSchema = z
  .object({
    id: z.literal(SLP_BUNDLED_POLICY_PLUGIN_ID),
    abiVersion: z.literal(BUNDLED_POLICY_PACK_ABI_VERSION),
    policyVersion: z.string().trim().min(1),
  })
  .strict();

export type BundledPolicyPackManifest = z.infer<typeof BundledPolicyPackManifestSchema>;

export interface BundledPolicyPackGeneration<TContribution> {
  owner: Extract<PolicyOwner, { kind: "plugin" }>;
  manifest: BundledPolicyPackManifest;
  contribution: TContribution;
}

export interface RegisterBundledPolicyPackInput<TContribution> {
  manifest: BundledPolicyPackManifest;
  artifactBytes: string | Uint8Array;
  contribution: TContribution;
}

export const BUNDLED_POLICY_PACK_MISSING_ERROR = "bundled_policy_pack_missing";
export const BUNDLED_POLICY_PACK_UNAVAILABLE_ERROR = "bundled_policy_pack_unavailable";
export const BUNDLED_POLICY_PACK_RESERVED_ID_ERROR = "bundled_policy_pack_reserved_id";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function generationKey(owner: Extract<PolicyOwner, { kind: "plugin" }>): string {
  return `${owner.pluginId}@${owner.generationDigest}`;
}

export function isBundledPolicyPluginId(pluginId: string): boolean {
  return RESERVED_BUNDLED_POLICY_PLUGIN_IDS.has(pluginId);
}

export function assertLocalPluginIdAvailable(pluginId: string): void {
  if (isBundledPolicyPluginId(pluginId)) {
    throw new Error(
      `${BUNDLED_POLICY_PACK_RESERVED_ID_ERROR}: local plugin ID '${pluginId}' is reserved`,
    );
  }
}

export class BundledPolicyPackRegistry<TContribution> {
  private readonly generations = new Map<string, BundledPolicyPackGeneration<TContribution>>();
  private readonly activeOwners = new Map<string, Extract<PolicyOwner, { kind: "plugin" }>>();
  private readonly loadFailures = new Map<string, string>();

  recordLoadFailure(pluginId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.loadFailures.set(pluginId, message);
  }

  registerGeneration(
    input: RegisterBundledPolicyPackInput<TContribution>,
  ): BundledPolicyPackGeneration<TContribution> {
    const manifest = BundledPolicyPackManifestSchema.parse(input.manifest);
    const owner = PolicyOwnerSchema.parse({
      kind: "plugin",
      pluginId: manifest.id,
      generationDigest: sha256(input.artifactBytes),
      policyVersion: manifest.policyVersion,
    });
    if (owner.kind !== "plugin") throw new Error("Bundled policy pack owner must be plugin-owned");
    const generation = { owner, manifest, contribution: input.contribution };
    const key = generationKey(owner);
    const existing = this.generations.get(key);
    if (existing) return existing;
    this.generations.set(key, generation);
    this.loadFailures.delete(manifest.id);
    return generation;
  }

  activate(owner: Extract<PolicyOwner, { kind: "plugin" }>): void {
    const generation = this.resolvePinned(owner);
    this.activeOwners.set(generation.owner.pluginId, generation.owner);
  }

  async installAndActivateCandidate(
    load: () => Promise<RegisterBundledPolicyPackInput<TContribution>>,
  ): Promise<BundledPolicyPackGeneration<TContribution>> {
    const candidate = await load();
    const generation = this.registerGeneration(candidate);
    this.activate(generation.owner);
    return generation;
  }

  resolveActive(pluginId: string): BundledPolicyPackGeneration<TContribution> {
    const owner = this.activeOwners.get(pluginId);
    if (!owner) {
      const failure = this.loadFailures.get(pluginId);
      if (failure) {
        throw new Error(`${BUNDLED_POLICY_PACK_UNAVAILABLE_ERROR}: '${pluginId}': ${failure}`);
      }
      throw new Error(
        `${BUNDLED_POLICY_PACK_MISSING_ERROR}: no active generation for '${pluginId}'`,
      );
    }
    return this.resolvePinned(owner);
  }

  resolvePinned(
    ownerInput: Extract<PolicyOwner, { kind: "plugin" }>,
  ): BundledPolicyPackGeneration<TContribution> {
    const owner = PolicyOwnerSchema.parse(ownerInput);
    if (owner.kind !== "plugin") throw new Error("Pinned policy owner must be plugin-owned");
    const generation = this.generations.get(generationKey(owner));
    if (!generation || generation.owner.policyVersion !== owner.policyVersion) {
      throw new Error(
        `${BUNDLED_POLICY_PACK_MISSING_ERROR}: generation '${generationKey(owner)}' is unavailable`,
      );
    }
    return generation;
  }
}
