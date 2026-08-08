import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { AgentStorage } from "./agent-storage.js";
import { withAgentAuthorityLock } from "./agent-authority-lock.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentResumeSessionOptions,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";

test("loads archived records for history and active records with the interactive default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-purpose-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) {
    throw new Error("expected Codex test client");
  }

  const resumeOptions: Array<AgentResumeSessionOptions | undefined> = [];
  const client: AgentClient = {
    provider: baseClient.provider,
    capabilities: baseClient.capabilities,
    createSession: async (
      config: AgentSessionConfig,
      launchContext?: AgentLaunchContext,
    ): Promise<AgentSession> => await baseClient.createSession(config, launchContext),
    resumeSession: async (
      handle: AgentPersistenceHandle,
      overrides?: Partial<AgentSessionConfig>,
      launchContext?: AgentLaunchContext,
      options?: AgentResumeSessionOptions,
    ): Promise<AgentSession> => {
      resumeOptions.push(options);
      return await baseClient.resumeSession(handle, overrides, launchContext);
    },
    fetchCatalog: async (options) => await baseClient.fetchCatalog(options),
    isAvailable: async () => await baseClient.isAvailable(),
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
  });

  const archivedId = "00000000-0000-4000-8000-000000000301";
  const activeId = "00000000-0000-4000-8000-000000000302";

  try {
    const archived = await manager.createAgent({ provider: "codex", cwd: root }, archivedId, {
      workspaceId: "workspace-archived",
    });
    await manager.archiveAgent(archived.id);

    const active = await manager.createAgent({ provider: "codex", cwd: root }, activeId, {
      workspaceId: "workspace-active",
    });
    await manager.closeAgent(active.id);

    await ensureAgentLoaded(archived.id, { agentManager: manager, agentStorage: storage, logger });
    await ensureAgentLoaded(active.id, { agentManager: manager, agentStorage: storage, logger });

    expect(resumeOptions).toEqual([{ purpose: "history" }, undefined]);
  } finally {
    await Promise.all([
      manager.closeAgent(archivedId).catch(() => undefined),
      manager.closeAgent(activeId).catch(() => undefined),
    ]);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("does not resume a predecessor with a released write lease", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-released-lead-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) throw new Error("expected Codex test client");
  let resumeCount = 0;
  const client: AgentClient = {
    provider: baseClient.provider,
    capabilities: baseClient.capabilities,
    createSession: async (config, launchContext) => baseClient.createSession(config, launchContext),
    resumeSession: async (handle, overrides, launchContext, options) => {
      resumeCount += 1;
      return baseClient.resumeSession(handle, overrides, launchContext, options);
    },
    fetchCatalog: async (options) => baseClient.fetchCatalog(options),
    isAvailable: async () => baseClient.isAvailable(),
  };
  const manager = new AgentManager({ clients: { codex: client }, registry: storage, logger });
  const agentId = "00000000-0000-4000-8000-000000000303";

  try {
    const created = await manager.createAgent({ provider: "codex", cwd: root }, agentId, {
      workspaceId: "workspace-released",
    });
    await manager.closeAgent(created.id);
    const record = await storage.get(agentId);
    if (!record) throw new Error("expected stored agent");
    let releaseAuthority!: () => void;
    const authorityHeld = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });
    let receiptPersisted!: () => void;
    const receiptReady = new Promise<void>((resolve) => {
      receiptPersisted = resolve;
    });
    const release = withAgentAuthorityLock(agentId, async () => {
      await storage.upsert({
        ...record,
        leadHandoffs: [
          {
            id: "handoff-released",
            workspaceId: "workspace-released",
            predecessorAgentId: agentId,
            successorAgentId: "lead-new",
            currentWriteOwnerAgentId: "lead-new",
            objective: "Preserve released runtime closure",
            scope: ["runtime"],
            currentState: "Released",
            decisions: [],
            failedApproaches: [],
            successfulPatterns: [],
            evidenceIndex: [{ ref: "test", claim: "Released receipt exists" }],
            activeRisksAndBlockers: [],
            exactResumePoint: "Use fresh Lead identity",
            stopCondition: "Do not resume predecessor",
            status: "predecessor_released",
            createdAt: new Date().toISOString(),
            receipts: [],
          },
        ],
      });
      receiptPersisted();
      await authorityHeld;
    });
    await receiptReady;
    const load = ensureAgentLoaded(agentId, {
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
    await Promise.resolve();
    expect(resumeCount).toBe(0);
    releaseAuthority();
    await release;

    await expect(load).rejects.toThrow(`agent_write_lease_released_runtime_closed: ${agentId}`);
    expect(resumeCount).toBe(0);
    expect(manager.getAgent(agentId)).toBeNull();
  } finally {
    await manager.closeAgent(agentId).catch(() => undefined);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
