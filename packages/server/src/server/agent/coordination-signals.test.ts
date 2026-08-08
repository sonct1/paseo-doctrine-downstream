import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import type { AgentManagerEvent } from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import {
  requestCoordinationSignal,
  resumePendingCoordinationSignalDeliveries,
  resolveCoordinationSignal,
  type CoordinationSignalDependencies,
} from "./coordination-signals.js";

function createScenario(
  options: {
    running?: boolean;
    agentId?: string;
    coordinationSignals?: StoredAgentRecord["coordinationSignals"];
  } = {},
) {
  const agentId = options.agentId ?? `lead-${crypto.randomUUID()}`;
  let running = options.running ?? false;
  let record = {
    id: agentId,
    provider: "codex",
    cwd: "/repo",
    workspaceId: "workspace-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    labels: {},
    lastStatus: running ? "running" : "idle",
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
      createdAt: new Date().toISOString(),
      instructions: "test",
    },
    coordinationSignals: options.coordinationSignals,
  } as StoredAgentRecord;
  const subscribers = new Set<(event: AgentManagerEvent) => void>();
  const sent: Array<{ agentId: string; message: string }> = [];
  const dependencies: CoordinationSignalDependencies = {
    agentStorage: {
      get: vi.fn(async (id: string) => (id === agentId ? record : null)),
      list: vi.fn(async () => [record]),
      upsert: vi.fn(async (next: StoredAgentRecord) => {
        record = next;
      }),
    },
    agentManager: {
      getAgent: vi.fn(() => null),
      hasInFlightRun: vi.fn(() => running),
      notifyAgentState: vi.fn(),
      subscribe: vi.fn((callback: (event: AgentManagerEvent) => void) => {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      }),
    },
    sendAtSafeBoundary: vi.fn(async (targetAgentId: string, message: string) => {
      if (running) {
        throw new Error("delivery attempted during active run");
      }
      sent.push({ agentId: targetAgentId, message });
    }),
    logger: pino({ level: "silent" }),
  };

  return {
    agentId,
    dependencies,
    getRecord: () => record,
    sent,
    reachIdleBoundary() {
      running = false;
      for (const subscriber of subscribers) {
        subscriber({
          type: "agent_state",
          agent: { id: agentId, lifecycle: "idle" },
        });
      }
    },
  };
}

describe("coordination signals", () => {
  test("restores delivery for an undelivered persisted signal after daemon startup", async () => {
    const agentId = `lead-${crypto.randomUUID()}`;
    const scenario = createScenario({
      agentId,
      coordinationSignals: [
        {
          id: crypto.randomUUID(),
          targetAgentId: agentId,
          requestedByAgentId: null,
          kind: "continuity_attention",
          trigger: "context_pressure",
          severity: "warning",
          recipientRole: "lead",
          source: { kind: "paseo", ruleId: "lead_context_pressure", version: 1 },
          reason: "Review continuity",
          evidenceRefs: [],
          status: "pending",
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          resolvedAt: null,
        },
      ],
    });

    const stop = await resumePendingCoordinationSignalDeliveries({
      ...scenario.dependencies,
    });

    await vi.waitFor(() => {
      expect(scenario.sent).toHaveLength(1);
      expect(scenario.getRecord().coordinationSignals?.[0]?.deliveredAt).not.toBeNull();
    });
    stop();
  });

  test("persists immediately but waits for an idle boundary without replacing active work", async () => {
    const scenario = createScenario({ running: true });
    const signal = await requestCoordinationSignal(scenario.dependencies, {
      targetAgentId: scenario.agentId,
      requestedByAgentId: "supervisor-1",
      kind: "handoff_recommended",
      reason: "Repeated context dilution",
      evidenceRefs: ["room-message-1"],
    });

    expect(scenario.sent).toEqual([]);
    expect(scenario.getRecord().coordinationSignals).toEqual([
      expect.objectContaining({ id: signal.id, status: "pending", deliveredAt: null }),
    ]);

    scenario.reachIdleBoundary();
    await vi.waitFor(() => expect(scenario.sent).toHaveLength(1));
    expect(scenario.sent[0]?.message).toContain("does not transfer authority");
    expect(scenario.sent[0]?.message).toContain(signal.id);
    expect(scenario.getRecord().coordinationSignals?.[0]?.deliveredAt).not.toBeNull();
  });

  test("deduplicates an unresolved recommendation from the same sender", async () => {
    const scenario = createScenario();
    const input = {
      targetAgentId: scenario.agentId,
      requestedByAgentId: "supervisor-1",
      kind: "detach_recommended" as const,
      reason: "Promote successor candidate",
      relatedAgentId: "candidate-1",
    };

    const first = await requestCoordinationSignal(scenario.dependencies, input);
    const second = await requestCoordinationSignal(scenario.dependencies, input);

    expect(second.id).toBe(first.id);
    expect(scenario.getRecord().coordinationSignals).toHaveLength(1);
  });

  test("records the Lead's autonomous disposition idempotently", async () => {
    const scenario = createScenario();
    const signal = await requestCoordinationSignal(scenario.dependencies, {
      targetAgentId: scenario.agentId,
      requestedByAgentId: "supervisor-1",
      kind: "handoff_recommended",
      reason: "Current phase is ready for adjacent-Lead handoff",
    });

    const first = await resolveCoordinationSignal(scenario.dependencies, {
      targetAgentId: scenario.agentId,
      signalId: signal.id,
      resolution: "deferred",
      note: "Finish the current bounded unit first",
    });
    const repeated = await resolveCoordinationSignal(scenario.dependencies, {
      targetAgentId: scenario.agentId,
      signalId: signal.id,
      resolution: "deferred",
      note: "Finish the current bounded unit first",
    });

    expect(first).toMatchObject({ status: "deferred", resolvedAt: expect.any(String) });
    expect(repeated).toEqual(first);
    expect(scenario.getRecord().coordinationSignals).toEqual([first]);
  });
});
