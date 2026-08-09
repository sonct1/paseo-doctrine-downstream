import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PASEO_ROLE_CONTRACT_VERSION, type PaseoRoleId } from "@getpaseo/protocol/role-binding";

export interface FoundationRoleDefinition {
  id: PaseoRoleId;
  version: string;
  instructions: string;
}

interface CanonicalRoleSource {
  schemaVersion: 1;
  contractVersion: string;
  universalBlocks: string[];
  roles: Record<PaseoRoleId, string[]>;
}

const ROLE_IDS: PaseoRoleId[] = ["lead", "peer", "supervisor"];

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function loadCanonicalRoleSource(): CanonicalRoleSource {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "foundation-role-definitions.json"),
    resolve(
      moduleDirectory,
      "../../../../../foundation/dist/profiles/native/role-definitions.json",
    ),
  ];
  let lastError: unknown;

  for (const candidatePath of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidatePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null) throw new Error("root must be an object");
      const source = parsed as Partial<CanonicalRoleSource>;
      if (source.schemaVersion !== 1) throw new Error("unsupported schemaVersion");
      if (source.contractVersion !== PASEO_ROLE_CONTRACT_VERSION) {
        throw new Error(
          `contractVersion ${String(source.contractVersion)} does not match ${PASEO_ROLE_CONTRACT_VERSION}`,
        );
      }
      if (!isNonEmptyStringArray(source.universalBlocks)) {
        throw new Error("universalBlocks must be a non-empty string array");
      }
      if (typeof source.roles !== "object" || source.roles === null) {
        throw new Error("roles must be an object");
      }
      for (const roleId of ROLE_IDS) {
        if (!isNonEmptyStringArray(source.roles[roleId])) {
          throw new Error(`roles.${roleId} must be a non-empty string array`);
        }
      }
      return source as CanonicalRoleSource;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to load canonical Foundation role definitions: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

const SOURCE = loadCanonicalRoleSource();
const UNIVERSAL_INSTRUCTIONS = SOURCE.universalBlocks.join("\n\n");
const DEFINITIONS = Object.fromEntries(
  ROLE_IDS.map((roleId) => [
    roleId,
    {
      id: roleId,
      version: SOURCE.contractVersion,
      instructions: `${UNIVERSAL_INSTRUCTIONS}\n\n${SOURCE.roles[roleId].join("\n\n")}`,
    },
  ]),
) as Record<PaseoRoleId, FoundationRoleDefinition>;

export function getFoundationRoleDefinition(roleId: PaseoRoleId): FoundationRoleDefinition {
  return DEFINITIONS[roleId];
}
