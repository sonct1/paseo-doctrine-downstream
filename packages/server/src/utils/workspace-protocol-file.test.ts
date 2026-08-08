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
  test("missing state provides a complete valid repository-specific bootstrap preview", () => {
    const repoRoot = makeRoot();
    const snapshot = inspectWorkspaceProtocol(repoRoot);

    expect(snapshot.status).toBe("missing");
    if (snapshot.status !== "missing") throw new Error("Expected missing snapshot");
    expect(snapshot.suggestedContent).toContain(`applies_to \`${repoRoot}\``);
    expect(validateWorkspaceProtocol(snapshot.suggestedContent)).toEqual([]);
  });

  test("classifies placeholders, conflict markers, unsupported versions, and missing clauses", () => {
    const content = `# Workspace Protocol\n\n<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 99 -->\n\n{{REQUIRED: owner}}\n<<<<<<< ours\n`;
    expect(validateWorkspaceProtocol(content)).toEqual(
      expect.arrayContaining([
        "unsupported_version",
        "unresolved_placeholder",
        "conflict_marker",
        "missing_identity",
        "missing_risk",
        "missing_topology",
        "missing_ownership",
        "missing_routing",
        "missing_project_policy",
        "missing_review_evidence",
        "missing_escalation",
        "missing_exceptions",
      ]),
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
