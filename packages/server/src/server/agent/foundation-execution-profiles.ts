import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PaseoRoleIdSchema, type PaseoRoleId } from "@getpaseo/protocol/role-binding";
import { z } from "zod";

export const FOUNDATION_EXECUTION_PROFILE_IDS = [
  "review",
  "solution-architect",
  "reviewer",
] as const;

export const FoundationExecutionProfileIdSchema = z.enum(FOUNDATION_EXECUTION_PROFILE_IDS);
export type FoundationExecutionProfileId = z.infer<typeof FoundationExecutionProfileIdSchema>;

export const ExecutionProfileBindingReceiptSchema = z.object({
  id: FoundationExecutionProfileIdSchema,
  version: z.string().min(1),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type ExecutionProfileBindingReceipt = z.infer<typeof ExecutionProfileBindingReceiptSchema>;

export interface FoundationExecutionProfileDefinition {
  id: FoundationExecutionProfileId;
  version: string;
  authorityRoleId: PaseoRoleId;
  foundationSkills: "none";
  instructions: string;
}

interface CanonicalExecutionProfile {
  version: string;
  authorityRoleId: PaseoRoleId;
  foundationSkills: "none";
  instructionBlocks: string[];
}

interface CanonicalExecutionProfileSource {
  schemaVersion: 1;
  profiles: Record<FoundationExecutionProfileId, CanonicalExecutionProfile>;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function parseCanonicalSource(candidatePath: string): CanonicalExecutionProfileSource {
  const parsed: unknown = JSON.parse(readFileSync(candidatePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("root must be an object");
  const source = parsed as Partial<CanonicalExecutionProfileSource>;
  if (source.schemaVersion !== 1) throw new Error("unsupported schemaVersion");
  if (typeof source.profiles !== "object" || source.profiles === null) {
    throw new Error("profiles must be an object");
  }
  for (const profileId of FOUNDATION_EXECUTION_PROFILE_IDS) {
    const profile = source.profiles[profileId];
    if (typeof profile !== "object" || profile === null) {
      throw new Error(`profiles.${profileId} must be an object`);
    }
    if (typeof profile.version !== "string" || profile.version.trim().length === 0) {
      throw new Error(`profiles.${profileId}.version must be a non-empty string`);
    }
    if (!PaseoRoleIdSchema.safeParse(profile.authorityRoleId).success) {
      throw new Error(`profiles.${profileId}.authorityRoleId must be a standing Paseo role`);
    }
    if (profile.foundationSkills !== "none") {
      throw new Error(`profiles.${profileId}.foundationSkills must be none`);
    }
    if (!isNonEmptyStringArray(profile.instructionBlocks)) {
      throw new Error(`profiles.${profileId}.instructionBlocks must be non-empty strings`);
    }
  }
  return source as CanonicalExecutionProfileSource;
}

function loadCanonicalSource(): CanonicalExecutionProfileSource {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "foundation-execution-specializations.json"),
    resolve(
      moduleDirectory,
      "../../../../../foundation/dist/profiles/native/execution-specializations.json",
    ),
  ];
  for (const candidatePath of candidates) {
    if (!existsSync(candidatePath)) continue;
    try {
      return parseCanonicalSource(candidatePath);
    } catch (error) {
      throw new Error(
        `Unable to load canonical Foundation execution specializations '${candidatePath}': ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  throw new Error("Unable to locate canonical Foundation execution specializations");
}

const SOURCE = loadCanonicalSource();
const DEFINITIONS = Object.fromEntries(
  FOUNDATION_EXECUTION_PROFILE_IDS.map((profileId) => {
    const profile = SOURCE.profiles[profileId];
    return [
      profileId,
      {
        id: profileId,
        version: profile.version,
        authorityRoleId: profile.authorityRoleId,
        foundationSkills: profile.foundationSkills,
        instructions: profile.instructionBlocks.join("\n\n"),
      },
    ];
  }),
) as Record<FoundationExecutionProfileId, FoundationExecutionProfileDefinition>;

export function getFoundationExecutionProfileDefinition(
  profileId: FoundationExecutionProfileId,
): FoundationExecutionProfileDefinition {
  return DEFINITIONS[profileId];
}

export function foundationExecutionProfileDefinitionDigest(
  profile: FoundationExecutionProfileDefinition,
): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}
