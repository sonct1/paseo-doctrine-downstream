import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import type { AgentManagerEvent, ManagedAgent } from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import {
  nativeCoordinationPolicyEnabled,
  startNativeCoordinationPolicy,
} from "./native-coordination-policy.js";

function roleBinding(roleId: "lead" | "peer" | "supervisor") {
  return {
    roleId,
    definitionVersion: "test",
    definitionDigest: "definition",
    bindingDigest: `binding-${roleId}`,
    provider: "codex",
    injectionMethod: "codex-developer-instructions" as const,
    qualification: "implementation-supported" as const,
    workspaceProtocol: { status: "missing" as const, path: "/repo/WORKSPACE_PROTOCOL.md" },
    createdAt: new Date().toISOString(),
    instructions: `Role: ${roleId}`,
  };
}

function createHarness() {
  const records = new Map<string, StoredAgentRecord>();
  const agents = new Map<string, ManagedAgent>();
  const subscribers = new Set<{
    callback: (event: AgentManagerEvent) => void;
    agentId?: string;
  }>();
  const sent: Array<{ agentId: string; message: string }> = [];

  function addAgent(input: {
    id: string;
    roleId: "lead" | "peer" | "supervisor";
    lifecycle?: "idle" | "running" | "error";
    parentAgentId?: string;
  }) {
    const binding = roleBinding(input.roleId);
    const labels = input.parentAgentId ? { "paseo.parent-agent-id": input.parentAgentId } : {};
    const lifecycle = input.lifecycle ?? "idle";
    agents.set(input.id, {
      id: input.id,
      provider: "codex",
      cwd: "/repo",
      workspaceId: "workspace-1",
      roleBinding: binding,
      labels,
      lifecycle,
      internal: false,
    } as ManagedAgent);
    records.set(input.id, {
      id: input.id,
      provider: "codex",
      cwd: "/repo",
      workspaceId: "workspace-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      labels,
      lastStatus: lifecycle,
      config: null,
      persistence: null,
      roleBinding: binding,
    });
  }

  const dependencies = {
    agentStorage: {
      get: vi.fn(async (id: string) => records.get(id) ?? null),
      list: vi.fn(async () => [...records.values()]),
      upsert: vi.fn(async (record: StoredAgentRecord) => {
        records.set(record.id, record);
      }),
    },
    agentManager: {
      getAgent: vi.fn((id: string) => agents.get(id) ?? null),
      listAgents: vi.fn(() => [...agents.values()]),
      hasInFlightRun: vi.fn((id: string) => agents.get(id)?.lifecycle === "running"),
      notifyAgentState: vi.fn(),
      subscribe: vi.fn(
        (
          callback: (event: AgentManagerEvent) => void,
          options?: { agentId?: string; replayState?: boolean },
        ) => {
          const subscription = { callback, agentId: options?.agentId };
          subscribers.add(subscription);
          return () => subscribers.delete(subscription);
        },
      ),
    },
    sendAtSafeBoundary: vi.fn(async (agentId: string, message: string) => {
      if (agents.get(agentId)?.lifecycle === "running") {
        throw new Error("unsafe delivery");
      }
      sent.push({ agentId, message });
    }),
    logger: pino({ level: "silent" }),
  };

  function emit(event: AgentManagerEvent) {
    for (const subscription of subscribers) {
      let eventAgentId: string | undefined;
      if (event.type === "agent_stream") {
        eventAgentId = event.agentId;
      } else if (event.type === "agent_state") {
        eventAgentId = event.agent.id;
      }
      if (!subscription.agentId || subscription.agentId === eventAgentId) {
        subscription.callback(event);
      }
    }
  }

  function setLifecycle(id: string, lifecycle: "idle" | "running" | "error") {
    const current = agents.get(id);
    if (!current) throw new Error(`missing agent ${id}`);
    const next = { ...current, lifecycle } as ManagedAgent;
    agents.set(id, next);
    emit({ type: "agent_state", agent: next });
  }

  return { addAgent, agents, dependencies, emit, records, sent, setLifecycle };
}

describe("native coordination policy", () => {
  test("is disabled by default and requires the exact candidate flag", () => {
    expect(nativeCoordinationPolicyEnabled({})).toBe(false);
    expect(
      nativeCoordinationPolicyEnabled({ PASEO_ENABLE_NATIVE_COORDINATION_POLICY: "true" }),
    ).toBe(false);
    expect(nativeCoordinationPolicyEnabled({ PASEO_ENABLE_NATIVE_COORDINATION_POLICY: "1" })).toBe(
      true,
    );
  });

  test("records context pressure and wakes Lead only at an idle boundary", async () => {
    const harness = createHarness();
    harness.addAgent({ id: "lead-1", roleId: "lead", lifecycle: "running" });
    const stop = startNativeCoordinationPolicy(harness.dependencies);

    harness.emit({
      type: "agent_stream",
      agentId: "lead-1",
      event: {
        type: "usage_updated",
        provider: "codex",
        usage: { contextWindowUsedTokens: 90, contextWindowMaxTokens: 100 },
      },
    });

    await vi.waitFor(() =>
      expect(harness.records.get("lead-1")?.coordinationSignals).toHaveLength(1),
    );
    expect(harness.sent).toEqual([]);
    expect(harness.records.get("lead-1")?.coordinationSignals?.[0]).toMatchObject({
      kind: "continuity_attention",
      trigger: "context_pressure",
      recipientRole: "lead",
      source: { kind: "paseo", ruleId: "lead_context_pressure", version: 1 },
    });

    harness.setLifecycle("lead-1", "idle");
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1));
    expect(harness.sent[0]?.message).toContain("Paseo coordination attention");
    expect(harness.sent[0]?.message).toContain("retain authority");
    stop();
  });

  test("turns provider automatic compaction into one Lead attention", async () => {
    const harness = createHarness();
    harness.addAgent({ id: "lead-1", roleId: "lead" });
    const stop = startNativeCoordinationPolicy(harness.dependencies);

    const compaction = {
      type: "agent_stream" as const,
      agentId: "lead-1",
      event: {
        type: "timeline" as const,
        provider: "claude",
        item: {
          type: "compaction" as const,
          status: "completed" as const,
          trigger: "auto" as const,
          preTokens: 180_000,
        },
      },
    };
    harness.emit(compaction);
    harness.emit(compaction);

    await vi.waitFor(() => expect(harness.sent).toHaveLength(1));
    expect(harness.records.get("lead-1")?.coordinationSignals).toHaveLength(1);
    expect(harness.records.get("lead-1")?.coordinationPolicyState).toMatchObject({
      automaticCompactionCount: 2,
      automaticCompactionAttentionSent: true,
    });
    stop();
  });

  test("routes three consecutive Peer failures to its Lead and ignores canceled turns", async () => {
    const harness = createHarness();
    harness.addAgent({ id: "lead-1", roleId: "lead" });
    harness.addAgent({ id: "peer-1", roleId: "peer", parentAgentId: "lead-1" });
    const stop = startNativeCoordinationPolicy(harness.dependencies);

    const failure = {
      type: "agent_stream" as const,
      agentId: "peer-1",
      event: { type: "turn_failed" as const, provider: "codex", error: "provider failed" },
    };
    harness.emit(failure);
    harness.emit({
      type: "agent_stream",
      agentId: "peer-1",
      event: { type: "turn_canceled", provider: "codex", reason: "human canceled" },
    });
    harness.emit(failure);
    harness.emit(failure);
    await vi.waitFor(() =>
      expect(harness.records.get("peer-1")?.coordinationPolicyState?.consecutiveTurnFailures).toBe(
        2,
      ),
    );
    expect(harness.records.get("lead-1")?.coordinationSignals).toBeUndefined();

    harness.emit(failure);
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1));
    expect(harness.records.get("lead-1")?.coordinationSignals?.[0]).toMatchObject({
      trigger: "repeated_failure",
      recipientRole: "lead",
      relatedAgentId: "peer-1",
    });
    stop();
  });

  test("escalates repeated Lead runtime failure only to a unique workspace Supervisor", async () => {
    const harness = createHarness();
    harness.addAgent({ id: "lead-1", roleId: "lead", lifecycle: "error" });
    harness.addAgent({ id: "supervisor-1", roleId: "supervisor" });
    const stop = startNativeCoordinationPolicy(harness.dependencies);

    for (let index = 0; index < 3; index += 1) {
      harness.emit({
        type: "agent_stream",
        agentId: "lead-1",
        event: { type: "turn_failed", provider: "codex", error: `failure-${index}` },
      });
    }

    await vi.waitFor(() => expect(harness.sent).toHaveLength(1));
    expect(harness.records.get("supervisor-1")?.coordinationSignals?.[0]).toMatchObject({
      severity: "critical",
      recipientRole: "supervisor",
      relatedAgentId: "lead-1",
      source: { kind: "paseo", ruleId: "lead_repeated_failure", version: 1 },
    });
    stop();
  });
});
