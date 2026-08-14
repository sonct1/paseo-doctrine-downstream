import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildWorkspaceProtocolTemplate,
  inspectWorkspaceProtocol,
  validateWorkspaceProtocol,
  writeWorkspaceProtocol,
} from "./workspace-protocol-file.js";
import { loadWorkspaceProtocolFixtureCorpus } from "./workspace-protocol-contract.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "workspace-protocol-file-test-"));
  tempDirs.push(root);
  return root;
}

describe("workspace protocol file", () => {
  test("shares the canonical Foundation fixture corpus", () => {
    for (const fixture of loadWorkspaceProtocolFixtureCorpus().cases) {
      expect(validateWorkspaceProtocol(fixture.content).length === 0, fixture.name).toBe(
        fixture.valid,
      );
    }
  });

  test("rejects an explicit applies_to path bound to another repository", () => {
    const repoRoot = makeRoot();
    const otherRoot = makeRoot();
    writeFileSync(
      join(repoRoot, "WORKSPACE_PROTOCOL.md"),
      buildWorkspaceProtocolTemplate(otherRoot),
      "utf8",
    );

    expect(inspectWorkspaceProtocol(repoRoot)).toMatchObject({
      status: "invalid",
      issues: expect.arrayContaining(["mismatched_identity_scope"]),
    });
  });
  test("missing state provides a complete valid repository-specific bootstrap preview", () => {
    const repoRoot = makeRoot();
    const snapshot = inspectWorkspaceProtocol(repoRoot);

    expect(snapshot.status).toBe("missing");
    if (snapshot.status !== "missing") throw new Error("Expected missing snapshot");
    expect(snapshot.suggestedContent).toContain(`applies_to \`${repoRoot}\``);
    expect(validateWorkspaceProtocol(snapshot.suggestedContent)).toEqual([]);
  });

  test("classifies placeholders, conflict markers, malformed versions, and missing identity", () => {
    const content = `# Workspace Protocol\n\n<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: v99beta -->\n\n{{REQUIRED: owner}}\n<<<<<<< ours\n`;
    expect(validateWorkspaceProtocol(content)).toEqual(
      expect.arrayContaining([
        "unsupported_version",
        "unresolved_placeholder",
        "conflict_marker",
        "missing_identity",
        "missing_issue_tracker",
      ]),
    );
    // A numerically higher version is the future, not corruption: it must not be rejected.
    expect(validateWorkspaceProtocol(content.replace("v99beta", "99"))).not.toContain(
      "unsupported_version",
    );
  });

  test("rejects legacy, markerless, and trackerless protocols during mandatory admission", () => {
    const loose =
      "# Quy ước làm việc\nowner: project owner\napplies_to: repository root\nversion: 1\n";
    expect(validateWorkspaceProtocol(loose)).toEqual(
      expect.arrayContaining(["missing_title", "missing_version_marker", "missing_issue_tracker"]),
    );
    // Schema evolution is additive, so the version number never gates admission: an older
    // marker still reads, and a version from a newer build degrades instead of failing closed.
    for (const version of [1, 2, 3, 9]) {
      expect(
        validateWorkspaceProtocol(
          `${loose}<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: ${version} -->\n`,
        ),
      ).not.toContain("unsupported_version");
    }
    // A marker that is not a version at all is corruption, not the future.
    for (const malformed of ["abc", "0", "-1", ""]) {
      expect(
        validateWorkspaceProtocol(
          `${loose}<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: ${malformed} -->\n`,
        ),
      ).toContain("unsupported_version");
    }
    expect(
      validateWorkspaceProtocol(
        `${loose}<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 3 -->\n<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 3 -->\n`,
      ),
    ).toContain("duplicate_version_marker");
  });

  test("requires one non-blank tracker field without guessing prose semantics", () => {
    const complete = buildWorkspaceProtocolTemplate(makeRoot());
    expect(validateWorkspaceProtocol(complete)).toEqual([]);
    expect(
      validateWorkspaceProtocol(complete.replace("- issue tracker:", "- work graph:")),
    ).toContain("missing_issue_tracker");
    expect(
      validateWorkspaceProtocol(complete.replace("Supervisor read-only", "Supervisor writes")),
    ).not.toContain("missing_issue_tracker");
    expect(validateWorkspaceProtocol(`${complete}- issue tracker: duplicate\n`)).toContain(
      "missing_issue_tracker",
    );
  });

  test("bootstraps only from the missing revision and returns a digest receipt", () => {
    const repoRoot = makeRoot();
    const content = buildWorkspaceProtocolTemplate(repoRoot, new Date("2026-08-08T00:00:00Z"));
    const result = writeWorkspaceProtocol({ repoRoot, content, expectedRevision: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.snapshot.status).toBe("valid");
    if (result.snapshot.status !== "valid") throw new Error("Expected valid snapshot");
    expect(result.snapshot.revision.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(readFileSync(join(repoRoot, "WORKSPACE_PROTOCOL.md"), "utf8")).toBe(content);
  });

  test("rejects invalid content without creating or partially mutating the file", () => {
    const repoRoot = makeRoot();
    const result = writeWorkspaceProtocol({
      repoRoot,
      content: "# Workspace Protocol\n",
      expectedRevision: null,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "invalid_content" }),
      }),
    );
    expect(readdirSync(repoRoot)).toEqual([]);
  });

  test("rejects a stale save and preserves the newer current bytes", () => {
    const repoRoot = makeRoot();
    const initial = buildWorkspaceProtocolTemplate(repoRoot, new Date("2026-08-08T00:00:00Z"));
    const first = writeWorkspaceProtocol({ repoRoot, content: initial, expectedRevision: null });
    if (!first.ok || first.snapshot.status !== "valid") throw new Error("bootstrap failed");

    const external = initial.replace("version `1`", "version `2`");
    writeFileSync(join(repoRoot, "WORKSPACE_PROTOCOL.md"), external);
    const attempted = initial.replace("version `1`", "version `3`");
    const result = writeWorkspaceProtocol({
      repoRoot,
      content: attempted,
      expectedRevision: first.snapshot.revision,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "stale_workspace_protocol" }),
      }),
    );
    expect(readFileSync(join(repoRoot, "WORKSPACE_PROTOCOL.md"), "utf8")).toBe(external);
    expect(readdirSync(repoRoot)).toEqual(["WORKSPACE_PROTOCOL.md"]);
  });

  test.skipIf(process.platform === "win32")(
    "preserves existing permissions across a valid atomic update",
    () => {
      const repoRoot = makeRoot();
      const initial = buildWorkspaceProtocolTemplate(repoRoot);
      const first = writeWorkspaceProtocol({ repoRoot, content: initial, expectedRevision: null });
      if (!first.ok || first.snapshot.status !== "valid") throw new Error("bootstrap failed");
      chmodSync(join(repoRoot, "WORKSPACE_PROTOCOL.md"), 0o640);
      const current = inspectWorkspaceProtocol(repoRoot);
      if (current.status !== "valid") throw new Error("inspect failed");

      const result = writeWorkspaceProtocol({
        repoRoot,
        content: initial.replace("version `1`", "version `2`"),
        expectedRevision: current.revision,
      });

      expect(result.ok).toBe(true);
      expect(statSync(join(repoRoot, "WORKSPACE_PROTOCOL.md")).mode & 0o777).toBe(0o640);
    },
  );
});
