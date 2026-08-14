import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkspaceProtocolContract {
  schemaVersion: 1;
  emittedVersion: number;
  maxBytes: number;
  titlePattern: string;
  markerMentionPattern: string;
  wellFormedMarkerPattern: string;
  placeholderPattern: string;
  targetRequiredFields: ["identity", "issue tracker"];
  canonicalFields: string[];
  canonicalIssueTrackerValue: string;
  fixtureCorpus: string;
}

export interface WorkspaceProtocolFixtureCorpus {
  schemaVersion: 1;
  contractSchemaVersion: 1;
  cases: Array<{ name: string; valid: boolean; content: string }>;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

function contractCandidates(fileName: string): string[] {
  const foundationSourceName = fileName.replace(/^foundation-/u, "");
  return [
    resolve(moduleDirectory, fileName),
    resolve(moduleDirectory, "../../../../foundation/dist/templates", foundationSourceName),
  ];
}

function readCanonicalJson(fileName: string): unknown {
  let lastError: unknown;
  for (const candidate of contractCandidates(fileName)) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Unable to load canonical Foundation ${fileName}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function nonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function loadContract(): WorkspaceProtocolContract {
  const parsed = readCanonicalJson(
    "foundation-workspace-protocol-contract.json",
  ) as Partial<WorkspaceProtocolContract>;
  if (
    parsed.schemaVersion !== 1 ||
    !Number.isInteger(parsed.emittedVersion) ||
    (parsed.emittedVersion ?? 0) < 1 ||
    !Number.isInteger(parsed.maxBytes) ||
    (parsed.maxBytes ?? 0) < 1 ||
    typeof parsed.titlePattern !== "string" ||
    typeof parsed.markerMentionPattern !== "string" ||
    typeof parsed.wellFormedMarkerPattern !== "string" ||
    typeof parsed.placeholderPattern !== "string" ||
    !nonEmptyStrings(parsed.targetRequiredFields) ||
    parsed.targetRequiredFields.join("\0") !== "identity\0issue tracker" ||
    !nonEmptyStrings(parsed.canonicalFields) ||
    typeof parsed.canonicalIssueTrackerValue !== "string" ||
    parsed.canonicalIssueTrackerValue.trim().length === 0 ||
    parsed.fixtureCorpus !== "workspace-protocol-fixtures.json"
  ) {
    throw new Error("Canonical Foundation Workspace Protocol contract is invalid");
  }
  return parsed as WorkspaceProtocolContract;
}

export const WORKSPACE_PROTOCOL_CONTRACT = loadContract();

export function loadWorkspaceProtocolFixtureCorpus(): WorkspaceProtocolFixtureCorpus {
  const parsed = readCanonicalJson(
    "foundation-workspace-protocol-fixtures.json",
  ) as Partial<WorkspaceProtocolFixtureCorpus>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.contractSchemaVersion !== WORKSPACE_PROTOCOL_CONTRACT.schemaVersion ||
    !Array.isArray(parsed.cases) ||
    parsed.cases.length === 0 ||
    parsed.cases.some(
      (fixture) =>
        typeof fixture !== "object" ||
        fixture === null ||
        typeof fixture.name !== "string" ||
        typeof fixture.valid !== "boolean" ||
        typeof fixture.content !== "string",
    )
  ) {
    throw new Error("Canonical Foundation Workspace Protocol fixture corpus is invalid");
  }
  return parsed as WorkspaceProtocolFixtureCorpus;
}
