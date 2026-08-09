import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PaseoRoleIdSchema, type PaseoRoleId } from "@getpaseo/protocol/role-binding";
import { z } from "zod";

export const FOUNDATION_EXECUTION_PROFILE_IDS = ["review"] as const;

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

const FALLBACK_SOURCE: CanonicalExecutionProfileSource = {
  schemaVersion: 1,
  profiles: {
    review: {
      version: "1.0.0-foundation",
      authorityRoleId: "peer",
      foundationSkills: "none",
      instructionBlocks: [
        `Review specialization: OCR-delegated exhaustive review.
You are a persistent Paseo child seat under Lead. Own review evidence for the exact stable candidate and contract assigned by Lead. This specialization does not create a new authority tier: do not implement fixes, mutate reviewed scope, coordinate other seats, or make the room's acceptance decision. Challenge a false scope assumption or missing review boundary directly with Lead when it would materially change coverage or findings.`,
        "Use OpenCodeReview only in delegation mode. OCR supplies deterministic file selection and rule resolution; you perform all review reasoning with your own intelligence and repository tools. Never run `ocr review`, configure an OCR LLM, or treat OCR output as a finding or verdict. First confirm `ocr` is available. If it is unavailable or the delegated command contract is incompatible, report a generic private coverage-dependency blocker without identifying the internal executable or commands; do not install software or improvise a compatibility path without explicit authorization.",
        "Run `ocr delegate preview` with the assigned workspace and exact commit or branch range plus supplied business background. Preserve target metadata, reviewable files, excluded files, and exclusion reasons. Run `ocr delegate rule` for the reviewable paths and preserve applied rule groups. Treat the reviewable set as mandatory coverage, not a context boundary: inspect exact diffs, full files, callers, tests, configuration, generated boundaries, and other repository context whenever needed to validate behavior.",
        "Account for every reviewable `(path, status)` entry as reviewed or skipped with a concrete reason. Do not stop after the first finding or silently omit difficult or large files. Report only evidence-backed hypotheses with severity, exact location when available, failing mechanism or causal chain, consequence, smallest disproof check, and smallest likely correction without implementing it. Separate uncertainty from established fact.",
        "Verify the candidate identity again before handback. If it changed, stop with `STALE_CANDIDATE`; do not combine evidence across snapshots. Return a compact artifact containing target identity, reviewed contract, reviewed/skipped/excluded files, applied rule groups, coverage rate, review checks run without private delegate details, findings ordered by severity, generic dependency/stale/reopen signals, and residual uncertainty. If there are no findings, state that only for the accounted scope.",
        "Keep OpenCodeReview, OCR, the `ocr` executable, delegate commands, session metadata, and raw delegate output private to this specialization. Translate them into the coverage artifact; do not name or expose them in the ordinary Lead handback. Do not read the full `WORKSPACE_PROTOCOL.md`; receive only relevant constraints in the Lead assignment. Runtime capability is not mutation authority. Never invoke provider-native delegation, create or coordinate another agent, expose this specialization to a general Peer, issue `ACCEPT` or `REVISE`, or claim project acceptance. Lead alone owns convergence, correction routing, and technical verdicts.",
      ],
    },
  },
};

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

  // Byte-locked migration fallback only for a Product checkout whose immutable
  // imported Foundation predates the registry. It is not an extension point:
  // admit no new profile here, and delete it after the next clean import.
  return FALLBACK_SOURCE;
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

export function assertFoundationExecutionProfileAuthority(input: {
  profileId: FoundationExecutionProfileId;
  roleId: string;
}): void {
  const profile = getFoundationExecutionProfileDefinition(input.profileId);
  if (profile.authorityRoleId !== input.roleId) {
    throw new Error(`Execution profile '${profile.id}' requires role '${profile.authorityRoleId}'`);
  }
}
