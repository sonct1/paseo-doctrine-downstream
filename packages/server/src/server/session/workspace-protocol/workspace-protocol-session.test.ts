import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import type { SessionOutboundMessage } from "../../messages.js";
import type { PersistedProjectRecord } from "../../workspace-registry.js";
import { WorkspaceProtocolSession } from "./workspace-protocol-session.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-protocol-session-test-")));
  tempDirs.push(root);
  return root;
}

function projectRecord(rootPath: string, archivedAt: string | null = null): PersistedProjectRecord {
  return {
    projectId: `project:${rootPath}`,
    rootPath,
    kind: "git",
    displayName: "Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt,
  };
}

function makeSession(records: PersistedProjectRecord[]) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new WorkspaceProtocolSession({
    host: { emit: (message) => emitted.push(message) },
    projectRegistry: { list: async () => records },
    logger: pino({ level: "silent" }),
  });
  return { session, emitted };
}

describe("WorkspaceProtocolSession", () => {
  test("inspects a known project and returns a bootstrap preview without writing", async () => {
    const repoRoot = makeRoot();
    const { session, emitted } = makeSession([projectRecord(repoRoot)]);

    await session.handleInspectRequest({
      type: "foundation.workspaceProtocol.inspect.request",
      requestId: "inspect-1",
      repoRoot,
    });

    expect(emitted).toEqual([
      {
        type: "foundation.workspaceProtocol.inspect.response",
        payload: {
          requestId: "inspect-1",
          ok: true,
          snapshot: expect.objectContaining({
            status: "missing",
            repoRoot,
            suggestedContent: expect.stringContaining("PASEO_WORKSPACE_PROTOCOL_VERSION"),
          }),
        },
      },
    ]);
    expect(() => readFileSync(join(repoRoot, "WORKSPACE_PROTOCOL.md"), "utf8")).toThrow();
  });

  test("writes a reviewed bootstrap for a known active project", async () => {
    const repoRoot = makeRoot();
    const { session, emitted } = makeSession([projectRecord(repoRoot)]);
    await session.handleInspectRequest({
      type: "foundation.workspaceProtocol.inspect.request",
      requestId: "inspect-1",
      repoRoot,
    });
    const response = emitted[0];
    if (
      response.type !== "foundation.workspaceProtocol.inspect.response" ||
      !response.payload.ok ||
      response.payload.snapshot.status !== "missing"
    ) {
      throw new Error("Expected missing preview");
    }

    await session.handleWriteRequest({
      type: "foundation.workspaceProtocol.write.request",
      requestId: "write-1",
      repoRoot,
      content: response.payload.snapshot.suggestedContent,
      expectedRevision: null,
    });

    expect(emitted[1]).toEqual({
      type: "foundation.workspaceProtocol.write.response",
      payload: {
        requestId: "write-1",
        ok: true,
        snapshot: expect.objectContaining({ status: "valid", repoRoot }),
      },
    });
  });

  test("rejects unknown and archived project roots without touching them", async () => {
    const archived = makeRoot();
    const unknown = makeRoot();
    const { session, emitted } = makeSession([projectRecord(archived, "2026-01-02T00:00:00.000Z")]);

    await session.handleInspectRequest({
      type: "foundation.workspaceProtocol.inspect.request",
      requestId: "archived-1",
      repoRoot: archived,
    });
    await session.handleWriteRequest({
      type: "foundation.workspaceProtocol.write.request",
      requestId: "unknown-1",
      repoRoot: unknown,
      content: "# Workspace Protocol\n",
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "foundation.workspaceProtocol.inspect.response",
        payload: {
          requestId: "archived-1",
          ok: false,
          error: { code: "project_not_found" },
        },
      },
      {
        type: "foundation.workspaceProtocol.write.response",
        payload: {
          requestId: "unknown-1",
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });
});
