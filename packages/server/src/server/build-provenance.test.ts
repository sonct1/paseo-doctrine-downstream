import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { readDaemonBuildProvenance } from "./build-provenance.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function moduleUrlWithArtifact(contents?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "paseo-build-provenance-"));
  tempDirs.push(root);
  const moduleDir = join(root, "server");
  mkdirSync(moduleDir, { recursive: true });
  if (contents !== undefined) {
    writeFileSync(join(root, "build-provenance.json"), JSON.stringify(contents));
  }
  return pathToFileURL(join(moduleDir, "build-provenance.js")).href;
}

describe("readDaemonBuildProvenance", () => {
  test("reads a complete generated artifact", () => {
    const artifact = {
      schemaVersion: 1,
      sourceRoot: "/repo/paseo-product",
      sourceCommit: "a".repeat(40),
      sourceDirty: false,
      sourceFingerprint: "b".repeat(64),
      builtAt: "2026-08-09T00:00:00.000Z",
    };
    expect(readDaemonBuildProvenance(moduleUrlWithArtifact(artifact))).toEqual({
      sourceRoot: artifact.sourceRoot,
      sourceCommit: artifact.sourceCommit,
      sourceDirty: false,
      sourceFingerprint: artifact.sourceFingerprint,
      builtAt: artifact.builtAt,
    });
  });

  test("fails closed when the artifact is absent or incomplete", () => {
    const unknown = {
      sourceRoot: null,
      sourceCommit: null,
      sourceDirty: null,
      sourceFingerprint: null,
      builtAt: null,
    };
    expect(readDaemonBuildProvenance(moduleUrlWithArtifact())).toEqual(unknown);
    expect(readDaemonBuildProvenance(moduleUrlWithArtifact({ schemaVersion: 1 }))).toEqual(unknown);
  });
});
