import pino from "pino";
import { describe, expect, test } from "vitest";

import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { BeadsNativeService } from "../../beads/beads-native-service.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

class BeadsAgentManagerFake {
  constructor(private readonly roleBound: boolean) {}

  public getAgent(agentId: string): ManagedAgent | null {
    if (agentId !== "agent-caller") return null;
    return {
      id: agentId,
      cwd: "/tmp/beads-agent",
      workspaceId: "workspace-1",
      internal: false,
      lifecycle: "idle",
      currentModeId: null,
      availableModes: [],
      config: { title: "Beads caller" },
      ...(this.roleBound ? { roleBinding: {} } : {}),
    } as ManagedAgent;
  }

  public listAgents(): ManagedAgent[] {
    return [];
  }
}

function catalog(callerAgentId: string | undefined, roleBound: boolean) {
  return createPaseoToolCatalog({
    agentManager: new BeadsAgentManagerFake(roleBound) as unknown as AgentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId,
    beadsService: {} as BeadsNativeService,
    workspaceRegistry: {} as Pick<WorkspaceRegistry, "get" | "list" | "upsert">,
    logger: pino({ level: "silent" }),
  });
}

describe("native Beads tool exposure", () => {
  test("exposes Beads only inside a role-bound agent catalog", () => {
    expect(catalog(undefined, false).getTool("beads_status")).toBeUndefined();
    expect(catalog("agent-caller", false).getTool("beads_status")).toBeUndefined();
    expect(catalog("agent-caller", true).getTool("beads_status")).toBeDefined();
  });
});
