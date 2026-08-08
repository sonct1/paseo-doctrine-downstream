import { describe, expect, test, vi } from "vitest";

import type { StoredAgentRecord } from "./agent-storage.js";
import { withAgentAuthorityLock } from "./agent-authority-lock.js";
import { prepareLeadHandoff, transitionLeadHandoff } from "./lead-handoffs.js";

function lead(id: string): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: "/repo",
    workspaceId: "workspace-1",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    labels: {},
    lastStatus: "idle",
    config: null,
    persistence: null,
    roleBinding: {
      roleId: "lead",
      definitionVersion: "test",
      definitionDigest: "definition",
      bindingDigest: "binding",
      provider: "codex",
      injectionMethod: "codex-config",
      qualification: "implementation-supported",
      workspaceProtocol: { status: "missing", path: "/repo/WORKSPACE_PROTOCOL.md" },
      createdAt: "2026-08-08T00:00:00.000Z",
      instructions: "test",
    },
  };
}

function scenario() {
  const records = new Map([
    ["lead-old", lead("lead-old")],
    ["lead-new", lead("lead-new")],
  ]);
  return {
    records,
    dependencies: {
      hasInFlightRun: vi.fn(() => false),
      closePredecessorRuntime: vi.fn(async (_agentId: string, _signal: AbortSignal) => undefined),
      agentStorage: {
        get: vi.fn(async (id: string) => records.get(id) ?? null),
        upsert: vi.fn(async (record: StoredAgentRecord) => {
          records.set(record.id, record);
        }),
      },
    },
  };
}

function completePacketInput() {
  return {
    predecessorAgentId: "lead-old",
    currentWriteOwnerAgentId: "lead-old",
    objective: "Continue P2 after a bounded checkpoint",
    scope: ["packages/server/src/server/agent"],
    currentState: "P0 is green and P1 successor rejected an incomplete packet",
    decisions: ["Authority transitions require explicit receipts"],
    failedApproaches: ["Narrative-only packet omitted the evidence index"],
    successfulPatterns: ["Independent successor review found missing fields"],
    evidenceIndex: [
      {
        ref: "agent:040e4059-2a61-44dc-9ec9-60e029ad7368",
        claim: "Successor rejected the incomplete packet",
      },
    ],
    activeRisksAndBlockers: ["No runtime lease enforcement exists"],
    exactResumePoint: "Implement and test immutable handoff packet receipts",
    stopCondition: "Stop before detach, archive, or role mutation",
  };
}

describe("Lead handoff packets", () => {
  test("persists the complete packet while retaining predecessor ownership", async () => {
    const testCase = scenario();
    const packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());

    expect(packet).toMatchObject({
      status: "packet_ready",
      successorAgentId: null,
      currentWriteOwnerAgentId: "lead-old",
      receipts: [],
    });
    expect(testCase.records.get("lead-old")?.leadHandoffs).toEqual([packet]);
    expect(testCase.records.get("lead-new")?.labels).toEqual({});
  });

  test("requires ordered Human and successor receipts before predecessor release", async () => {
    const testCase = scenario();
    let packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());

    await expect(
      transitionLeadHandoff(testCase.dependencies, {
        predecessorAgentId: "lead-old",
        handoffId: packet.id,
        transition: "successor_acknowledged",
        actorAgentId: "lead-new",
        note: "Packet is sufficient",
      }),
    ).rejects.toThrow("requires successor_authorized");

    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Human authorizes the designated successor",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_acknowledged",
      actorAgentId: "lead-new",
      note: "Packet is sufficient",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "predecessor_released",
      actorAgentId: null,
      note: "Human releases predecessor after successor ACK",
    });

    expect(packet.status).toBe("predecessor_released");
    expect(packet.currentWriteOwnerAgentId).toBe("lead-new");
    expect(testCase.dependencies.closePredecessorRuntime).toHaveBeenCalledWith(
      "lead-old",
      expect.any(AbortSignal),
    );
    expect(packet.receipts.map((receipt) => receipt.transition)).toEqual([
      "successor_authorized",
      "successor_acknowledged",
      "predecessor_released",
    ]);
    expect(testCase.records.get("lead-old")?.roleBinding?.roleId).toBe("lead");
    expect(testCase.records.get("lead-new")?.roleBinding?.roleId).toBe("lead");
  });

  test("rejects release while the predecessor is running without partial mutation", async () => {
    const testCase = scenario();
    let packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Human authorization",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_acknowledged",
      actorAgentId: "lead-new",
      note: "Packet accepted",
    });
    testCase.dependencies.hasInFlightRun.mockReturnValue(true);

    await expect(
      transitionLeadHandoff(testCase.dependencies, {
        predecessorAgentId: "lead-old",
        handoffId: packet.id,
        transition: "predecessor_released",
        actorAgentId: null,
        note: "Unsafe release attempt",
      }),
    ).rejects.toThrow("in-flight run");

    expect(testCase.records.get("lead-old")?.leadHandoffs?.[0]).toMatchObject({
      status: "successor_acknowledged",
      currentWriteOwnerAgentId: "lead-old",
    });
    expect(testCase.dependencies.closePredecessorRuntime).not.toHaveBeenCalled();
  });

  test("does not transfer ownership when predecessor runtime closure fails", async () => {
    const testCase = scenario();
    let packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Human authorization",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_acknowledged",
      actorAgentId: "lead-new",
      note: "Packet accepted",
    });
    testCase.dependencies.closePredecessorRuntime.mockRejectedValueOnce(
      new Error("runtime close failed"),
    );

    await expect(
      transitionLeadHandoff(testCase.dependencies, {
        predecessorAgentId: "lead-old",
        handoffId: packet.id,
        transition: "predecessor_released",
        actorAgentId: null,
        note: "Unsafe partial release attempt",
      }),
    ).rejects.toThrow("runtime close failed");

    expect(testCase.records.get("lead-old")?.leadHandoffs?.[0]).toMatchObject({
      status: "successor_acknowledged",
      currentWriteOwnerAgentId: "lead-old",
    });
  });

  test("bounds a hanging close and releases the successor authority lock", async () => {
    const testCase = scenario();
    let packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Human authorization",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_acknowledged",
      actorAgentId: "lead-new",
      note: "Packet accepted",
    });
    let continueClose: (() => void) | undefined;
    let closeSideEffect = false;
    const closeBlocked = new Promise<void>((resolve) => {
      continueClose = resolve;
    });
    testCase.dependencies.closePredecessorRuntime.mockImplementationOnce(
      async (_agentId, signal) => {
        await closeBlocked;
        signal.throwIfAborted();
        closeSideEffect = true;
      },
    );

    await expect(
      transitionLeadHandoff(
        { ...testCase.dependencies, predecessorRuntimeCloseTimeoutMs: 5 },
        {
          predecessorAgentId: "lead-old",
          handoffId: packet.id,
          transition: "predecessor_released",
          actorAgentId: null,
          note: "Bounded hanging release attempt",
        },
      ),
    ).rejects.toThrow("predecessor_runtime_close_timeout");

    continueClose?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeSideEffect).toBe(false);

    await expect(withAgentAuthorityLock("lead-new", async () => "successor-live")).resolves.toBe(
      "successor-live",
    );
    expect(testCase.records.get("lead-old")?.leadHandoffs?.[0]).toMatchObject({
      status: "successor_acknowledged",
      currentWriteOwnerAgentId: "lead-old",
    });
  });

  test("rejects a false owner and a non-designated successor acknowledgement", async () => {
    const testCase = scenario();
    await expect(
      prepareLeadHandoff(testCase.dependencies, {
        ...completePacketInput(),
        currentWriteOwnerAgentId: "lead-new",
      }),
    ).rejects.toThrow("predecessor to remain the current write Owner");

    const packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());
    await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Human authorization",
    });
    await expect(
      transitionLeadHandoff(testCase.dependencies, {
        predecessorAgentId: "lead-old",
        handoffId: packet.id,
        transition: "successor_acknowledged",
        actorAgentId: "other-lead",
        note: "Spoofed acknowledgement",
      }),
    ).rejects.toThrow("designated successor");
  });

  test("forbids reactivating a released predecessor identity as a successor", async () => {
    const testCase = scenario();
    let packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Authorized",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_acknowledged",
      actorAgentId: "lead-new",
      note: "Acknowledged",
    });
    await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "predecessor_released",
      actorAgentId: null,
      note: "Released",
    });

    await expect(
      prepareLeadHandoff(testCase.dependencies, {
        ...completePacketInput(),
        predecessorAgentId: "lead-new",
        proposedSuccessorAgentId: "lead-old",
        currentWriteOwnerAgentId: "lead-new",
      }),
    ).rejects.toThrow("fresh role-bound Lead");
  });

  test("revalidates successor eligibility at final release", async () => {
    const testCase = scenario();
    let packet = await prepareLeadHandoff(testCase.dependencies, completePacketInput());
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_authorized",
      actorAgentId: null,
      successorAgentId: "lead-new",
      note: "Authorized",
    });
    packet = await transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "successor_acknowledged",
      actorAgentId: "lead-new",
      note: "Acknowledged",
    });
    const successor = testCase.records.get("lead-new") as StoredAgentRecord;
    testCase.records.set("lead-new", {
      ...successor,
      leadHandoffs: [
        {
          ...packet,
          id: "later-handoff",
          predecessorAgentId: "lead-new",
          successorAgentId: "lead-third",
          currentWriteOwnerAgentId: "lead-third",
          status: "predecessor_released",
        },
      ],
    });

    await expect(
      transitionLeadHandoff(testCase.dependencies, {
        predecessorAgentId: "lead-old",
        handoffId: packet.id,
        transition: "predecessor_released",
        actorAgentId: null,
        note: "Stale release attempt",
      }),
    ).rejects.toThrow("fresh role-bound Lead");
    expect(testCase.records.get("lead-old")?.leadHandoffs?.[0].status).toBe(
      "successor_acknowledged",
    );
  });
});
