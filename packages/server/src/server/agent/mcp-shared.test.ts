import pino from "pino";
import { expect, test, vi } from "vitest";

import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { ManagedAgent } from "./agent-manager.js";
import { serializeSnapshotWithMetadata } from "./mcp-shared.js";

function liveSnapshot(): ManagedAgent {
  const now = new Date("2026-08-08T00:00:00.000Z");
  return {
    id: "lead-old",
    provider: "codex",
    cwd: "/repo",
    workspaceId: "workspace-1",
    session: {},
    sessionId: "session-1",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    config: { provider: "codex", cwd: "/repo" },
    lifecycle: "idle",
    createdAt: now,
    updatedAt: now,
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    activeForegroundTurnId: null,
    activeTurnId: null,
    activeTurnStartedAt: null,
    foregroundTurnWaiters: new Set(),
    unsubscribeSession: null,
    timeline: [],
    runtimeInfo: null,
    persistence: null,
    historyPrimed: true,
    lastUserMessageAt: now,
    attention: { requiresAttention: false },
  } as ManagedAgent;
}

test("live status merges durable coordination and handoff metadata", async () => {
  const record = {
    title: "Predecessor Lead",
    coordinationSignals: [
      {
        id: "signal-1",
        targetAgentId: "lead-old",
        requestedByAgentId: null,
        kind: "handoff_recommended",
        reason: "Review continuity",
        evidenceRefs: [],
        status: "pending",
        createdAt: "2026-08-08T00:00:00.000Z",
        deliveredAt: null,
        resolvedAt: null,
      },
    ],
    leadHandoffs: [
      {
        id: "handoff-1",
        workspaceId: "workspace-1",
        predecessorAgentId: "lead-old",
        successorAgentId: "lead-new",
        currentWriteOwnerAgentId: "lead-old",
        objective: "Continue bounded work",
        scope: ["packages/server"],
        currentState: "Successor acknowledged",
        decisions: [],
        failedApproaches: [],
        successfulPatterns: [],
        evidenceIndex: [{ ref: "pilot", claim: "Packet verified" }],
        activeRisksAndBlockers: [],
        exactResumePoint: "Human release",
        stopCondition: "No lifecycle mutation",
        status: "successor_acknowledged",
        createdAt: "2026-08-08T00:00:00.000Z",
        receipts: [],
      },
    ],
  } as StoredAgentRecord;
  const agentStorage = {
    get: vi.fn(async () => record),
  } as unknown as AgentStorage;

  const serialized = await serializeSnapshotWithMetadata(
    agentStorage,
    liveSnapshot(),
    pino({ level: "silent" }),
  );

  expect(serialized.title).toBe("Predecessor Lead");
  expect(serialized.coordinationSignals?.[0]?.id).toBe("signal-1");
  expect(serialized.leadHandoffs?.[0]?.id).toBe("handoff-1");
});
