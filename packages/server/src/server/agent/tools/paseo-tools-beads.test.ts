import pino from "pino";
import { describe, expect, test } from "vitest";

import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { BeadsService } from "../../beads/beads-service.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

class BeadsAgentManagerFake {
  constructor(private readonly roleId: "lead" | "peer" | "supervisor" | null) {}

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
      ...(this.roleId ? { roleBinding: { roleId: this.roleId } } : {}),
    } as ManagedAgent;
  }

  public listAgents(): ManagedAgent[] {
    return [];
  }
}

function catalog(callerAgentId: string | undefined, roleId: "lead" | "peer" | "supervisor" | null) {
  return createPaseoToolCatalog({
    agentManager: new BeadsAgentManagerFake(roleId) as unknown as AgentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId,
    beadsService: {} as BeadsService,
    workspaceRegistry: {} as Pick<WorkspaceRegistry, "get" | "list" | "upsert">,
    logger: pino({ level: "silent" }),
  });
}

describe("Beads Central tool exposure", () => {
  test("exposes Beads only inside a role-bound agent catalog", () => {
    expect(catalog(undefined, null).getTool("beads_status")).toBeUndefined();
    expect(catalog("agent-caller", null).getTool("beads_status")).toBeUndefined();
    expect(catalog("agent-caller", "lead").getTool("beads_status")).toBeDefined();
  });

  test("projects the least-authority mutation surface for each role", () => {
    const lead = catalog("agent-caller", "lead");
    const peer = catalog("agent-caller", "peer");
    const supervisor = catalog("agent-caller", "supervisor");

    expect(lead.getTool("beads_create")).toBeDefined();
    expect(lead.getTool("beads_close")).toBeDefined();
    expect(peer.getTool("beads_create")).toBeDefined();
    expect(peer.getTool("beads_close")).toBeUndefined();
    expect(supervisor.getTool("beads_get")).toBeDefined();
    expect(supervisor.getTool("beads_create")).toBeUndefined();
    expect(supervisor.getTool("beads_claim")).toBeUndefined();
    expect(supervisor.getTool("beads_update")).toBeUndefined();
    expect(supervisor.getTool("beads_close")).toBeUndefined();
    expect(supervisor.getTool("beads_add_dependency")).toBeUndefined();
  });
});
