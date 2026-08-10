import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DaemonBuildProvenance {
  sourceRoot: string | null;
  sourceCommit: string | null;
  sourceDirty: boolean | null;
  sourceFingerprint: string | null;
  builtAt: string | null;
}

const UNKNOWN_PROVENANCE: DaemonBuildProvenance = {
  sourceRoot: null,
  sourceCommit: null,
  sourceDirty: null,
  sourceFingerprint: null,
  builtAt: null,
};

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function readDaemonBuildProvenance(moduleUrl = import.meta.url): DaemonBuildProvenance {
  try {
    const artifactPath = resolve(dirname(fileURLToPath(moduleUrl)), "../build-provenance.json");
    const parsed: unknown = JSON.parse(readFileSync(artifactPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return UNKNOWN_PROVENANCE;
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.schemaVersion !== 1 ||
      !isString(candidate.sourceRoot) ||
      !(candidate.sourceCommit === null || isString(candidate.sourceCommit)) ||
      !(candidate.sourceDirty === null || typeof candidate.sourceDirty === "boolean") ||
      !(candidate.sourceFingerprint === null || isString(candidate.sourceFingerprint)) ||
      !isString(candidate.builtAt)
    ) {
      return UNKNOWN_PROVENANCE;
    }
    return {
      sourceRoot: candidate.sourceRoot,
      sourceCommit: candidate.sourceCommit,
      sourceDirty: candidate.sourceDirty,
      sourceFingerprint: candidate.sourceFingerprint,
      builtAt: candidate.builtAt,
    };
  } catch {
    return UNKNOWN_PROVENANCE;
  }
}

export const DAEMON_BUILD_PROVENANCE = readDaemonBuildProvenance();
