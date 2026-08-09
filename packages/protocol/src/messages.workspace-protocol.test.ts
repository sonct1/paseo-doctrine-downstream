import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

const revision = { mtimeMs: 1, size: 42, sha256: "a".repeat(64) };

describe("Workspace Protocol RPC schemas", () => {
  test("accepts dotted inspect and write requests", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "foundation.workspaceProtocol.inspect.request",
        requestId: "inspect-1",
        repoRoot: "/repo/app",
      }),
    ).toEqual({
      type: "foundation.workspaceProtocol.inspect.request",
      requestId: "inspect-1",
      repoRoot: "/repo/app",
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "foundation.workspaceProtocol.write.request",
        requestId: "write-1",
        repoRoot: "/repo/app",
        content: "# Workspace Protocol\n",
        expectedRevision: revision,
      }),
    ).toEqual(
      expect.objectContaining({
        type: "foundation.workspaceProtocol.write.request",
        expectedRevision: revision,
      }),
    );
  });

  test("accepts all inspect states and stale write receipts", () => {
    const missing = {
      status: "missing" as const,
      repoRoot: "/repo/app",
      path: "/repo/app/WORKSPACE_PROTOCOL.md",
      suggestedContent: "# Workspace Protocol\n",
      revision: null,
      issues: [],
    };
    expect(
      SessionOutboundMessageSchema.parse({
        type: "foundation.workspaceProtocol.inspect.response",
        payload: { requestId: "inspect-1", ok: true, snapshot: missing },
      }),
    ).toBeTruthy();

    expect(
      SessionOutboundMessageSchema.parse({
        type: "foundation.workspaceProtocol.write.response",
        payload: {
          requestId: "write-1",
          ok: false,
          error: { code: "stale_workspace_protocol", current: missing },
        },
      }),
    ).toBeTruthy();
  });

  test("rejects malformed revision digests", () => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "foundation.workspaceProtocol.write.request",
        requestId: "write-1",
        repoRoot: "/repo/app",
        content: "# Workspace Protocol\n",
        expectedRevision: { ...revision, sha256: "not-a-digest" },
      }),
    ).toThrow();
  });
});
