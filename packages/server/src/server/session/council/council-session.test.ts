import { describe, expect, it, vi } from "vitest";
import type { CouncilCaseStore } from "../../council/council-case-store.js";
import { CouncilSession } from "./council-session.js";

const NOW = "2026-08-10T10:00:00.000Z";

describe("CouncilSession", () => {
  it("returns canonical cases with request correlation", async () => {
    const emit = vi.fn();
    const store = {
      list: vi.fn(async () => [
        {
          schemaVersion: 1 as const,
          id: "case-1",
          title: "Boundary",
          question: "Where?",
          tier: "lens" as const,
          phase: "sealed" as const,
          roomId: "room-1",
          kickoffMessageId: "kickoff-1",
          scopeId: "parent:lead-1",
          workspaceId: null,
          projectId: null,
          parentAgentId: "lead-1",
          seats: [
            {
              role: "reviewer" as const,
              round: "1",
              agentId: null,
              phase: "sealed" as const,
              integrity: "unspecified" as const,
              disposition: null,
              reportReceipt: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]),
    };
    const session = new CouncilSession({ emit }, store as Pick<CouncilCaseStore, "list">);

    await session.handleListRequest({
      type: "council.case.list.request",
      requestId: "request-1",
    });

    expect(emit).toHaveBeenCalledWith({
      type: "council.case.list.response",
      payload: {
        requestId: "request-1",
        cases: [expect.objectContaining({ id: "case-1", scopeId: "parent:lead-1" })],
        error: null,
      },
    });
  });

  it("contains store failures inside the Council RPC", async () => {
    const emit = vi.fn();
    const store = { list: vi.fn(async () => Promise.reject(new Error("corrupt case store"))) };
    const session = new CouncilSession({ emit }, store as Pick<CouncilCaseStore, "list">);

    await session.handleListRequest({
      type: "council.case.list.request",
      requestId: "request-2",
    });

    expect(emit).toHaveBeenCalledWith({
      type: "council.case.list.response",
      payload: {
        requestId: "request-2",
        cases: [],
        error: "corrupt case store",
      },
    });
  });
});
