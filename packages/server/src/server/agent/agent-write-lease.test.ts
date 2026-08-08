import { expect, test, vi } from "vitest";

import { AgentManager } from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import { startAgentRun } from "./agent-prompt.js";
import { prepareLeadHandoff, transitionLeadHandoff } from "./lead-handoffs.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

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
  let inFlight = false;
  const storage = {
    get: vi.fn(async (id: string) => records.get(id) ?? null),
    getCached: vi.fn((id: string) => records.get(id) ?? null),
    upsert: vi.fn(async (record: StoredAgentRecord) => {
      records.set(record.id, record);
    }),
  };
  const manager: AgentManager = Object.create(AgentManager.prototype);
  Reflect.set(manager, "registry", storage);
  Reflect.set(manager, "requireAgent", (id: string) => ({
    id,
    roleBinding: records.get(id)?.roleBinding,
  }));
  Reflect.set(
    manager,
    "streamAgent",
    vi.fn(() => {
      inFlight = true;
      return (async function* noop() {})();
    }),
  );
  const dependencies = { agentStorage: storage, hasInFlightRun: () => inFlight };
  return { records, manager, dependencies, setInFlight: (value: boolean) => (inFlight = value) };
}

async function acknowledgedPacket(testCase: ReturnType<typeof scenario>) {
  let packet = await prepareLeadHandoff(testCase.dependencies, {
    predecessorAgentId: "lead-old",
    proposedSuccessorAgentId: "lead-new",
    currentWriteOwnerAgentId: "lead-old",
    objective: "Transfer bounded ownership",
    scope: ["src/**"],
    currentState: "Ready",
    decisions: [],
    failedApproaches: [],
    successfulPatterns: [],
    evidenceIndex: [{ ref: "test", claim: "Ready" }],
    activeRisksAndBlockers: [],
    exactResumePoint: "Release",
    stopCondition: "Stop after release",
  });
  packet = await transitionLeadHandoff(testCase.dependencies, {
    predecessorAgentId: "lead-old",
    handoffId: packet.id,
    transition: "successor_authorized",
    actorAgentId: null,
    successorAgentId: "lead-new",
    note: "Authorized",
  });
  return transitionLeadHandoff(testCase.dependencies, {
    predecessorAgentId: "lead-old",
    handoffId: packet.id,
    transition: "successor_acknowledged",
    actorAgentId: "lead-new",
    note: "Acknowledged",
  });
}

test("runAgent schedule path rejects predecessor after release", async () => {
  const testCase = scenario();
  const packet = await acknowledgedPacket(testCase);
  await transitionLeadHandoff(testCase.dependencies, {
    predecessorAgentId: "lead-old",
    handoffId: packet.id,
    transition: "predecessor_released",
    actorAgentId: null,
    note: "Released",
  });

  await expect(testCase.manager.runAgent("lead-old", "scheduled fire")).rejects.toThrow(
    "agent_write_lease_released",
  );
});

test("out-of-band prompt path is lease-checked before provider handling", async () => {
  const testCase = scenario();
  const packet = await acknowledgedPacket(testCase);
  await transitionLeadHandoff(testCase.dependencies, {
    predecessorAgentId: "lead-old",
    handoffId: packet.id,
    transition: "predecessor_released",
    actorAgentId: null,
    note: "Released",
  });
  const outOfBand = vi.fn(() => true);
  Reflect.set(testCase.manager, "getAgent", () => ({ id: "lead-old" }));
  Reflect.set(testCase.manager, "tryRunOutOfBand", outOfBand);
  Reflect.set(testCase.manager, "hasInFlightRun", () => false);

  await expect(
    startAgentRun(testCase.manager, "lead-old", "/goal pause", createTestLogger()),
  ).rejects.toThrow("agent_write_lease_released");
  expect(outOfBand).not.toHaveBeenCalled();
});

test("core dispatch and final release share one race boundary", async () => {
  const testCase = scenario();
  const packet = await acknowledgedPacket(testCase);

  await testCase.manager.startAuthorizedAgentStream("lead-old", "scheduled fire");
  await expect(
    transitionLeadHandoff(testCase.dependencies, {
      predecessorAgentId: "lead-old",
      handoffId: packet.id,
      transition: "predecessor_released",
      actorAgentId: null,
      note: "Racing release",
    }),
  ).rejects.toThrow("in-flight run");

  expect(testCase.records.get("lead-old")?.leadHandoffs?.[0].status).toBe("successor_acknowledged");
  testCase.setInFlight(false);
});
