import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { CouncilCaseStore } from "./council-case-store.js";

const temporaryDirectories: string[] = [];
const NOW = "2026-08-10T10:00:00.000Z";

async function createHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-council-store-"));
  temporaryDirectories.push(home);
  return home;
}

function legacyAgent(
  id: string,
  workspaceId: string | undefined,
  role: string,
  parentAgentId: string | null,
): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: "/repo",
    ...(workspaceId ? { workspaceId } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    labels: {
      "council.case_id": "case-shared",
      "council.title": "Legacy decision",
      "council.tier": "debate-with-proof",
      "council.phase": "review",
      "council.role": role,
      "council.round": "1",
      "council.integrity": "unspecified",
      "council.room_id": "room-1",
      "council.kickoff_message_id": "kickoff-1",
      ...(parentAgentId ? { "paseo.parent-agent-id": parentAgentId } : {}),
    },
    lastStatus: "closed",
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CouncilCaseStore", () => {
  it("persists one canonical case through seat assignment and audited report recording", async () => {
    const paseoHome = await createHome();
    const onCaseUpdated = vi.fn();
    const store = new CouncilCaseStore({
      paseoHome,
      logger: createTestLogger(),
      onCaseUpdated,
    });
    const created = await store.create({
      id: "case-1",
      title: "Choose a boundary",
      question: "Where should the boundary live?",
      tier: "debate-with-proof",
      roomId: "room-1",
      kickoffMessageId: "kickoff-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      parentAgentId: "lead-1",
      roles: ["scout", "architect", "reviewer"],
    });
    expect(created.scopeId).toBe("workspace:workspace-1");

    await store.assertSeatLaunch("case-1", "scout", "lead-1", "workspace-1");
    await store.assignSeat({
      caseId: "case-1",
      role: "scout",
      agentId: "scout-1",
      parentAgentId: "lead-1",
      workspaceId: "workspace-1",
    });
    await store.recordSeat({
      caseId: "case-1",
      agentId: "scout-1",
      phase: "review",
      integrity: "valid",
      disposition: "supported",
      reportReceipt: {
        roomId: "room-1",
        kickoffMessageId: "kickoff-1",
        reportMessageId: "report-1",
        reportDigest: "a".repeat(64),
        authorAgentId: "scout-1",
        startSentinel: "SCOUT_COUNCIL_REPORT_V1",
        endSentinel: "SCOUT_COUNCIL_REPORT_END",
        createdAt: NOW,
      },
    });
    expect(onCaseUpdated).toHaveBeenCalledTimes(3);
    expect(onCaseUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "case-1", phase: "review" }),
    );

    const reloaded = new CouncilCaseStore({ paseoHome, logger: createTestLogger() });
    await expect(reloaded.list()).resolves.toMatchObject([
      {
        id: "case-1",
        phase: "review",
        seats: [
          {
            role: "scout",
            agentId: "scout-1",
            integrity: "valid",
            disposition: "supported",
            reportReceipt: { reportMessageId: "report-1" },
          },
          { role: "architect", agentId: null },
          { role: "reviewer", agentId: null },
        ],
      },
    ]);
  });

  it("rolls in-memory state back when the atomic write fails", async () => {
    const onCaseUpdated = vi.fn();
    const writeJson = vi.fn(async () => {
      throw new Error("disk full");
    });
    const store = new CouncilCaseStore({
      paseoHome: await createHome(),
      logger: createTestLogger(),
      writeJson,
      onCaseUpdated,
    });

    await expect(
      store.create({
        id: "case-rollback",
        title: "Rollback",
        question: "Does state roll back?",
        tier: "lens",
        roomId: "room-1",
        kickoffMessageId: "kickoff-1",
        workspaceId: null,
        projectId: null,
        parentAgentId: "lead-1",
        roles: ["reviewer"],
      }),
    ).rejects.toThrow("disk full");
    await expect(store.list()).resolves.toEqual([]);
    expect(onCaseUpdated).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace launch and phase regression at the aggregate boundary", async () => {
    const store = new CouncilCaseStore({
      paseoHome: await createHome(),
      logger: createTestLogger(),
    });
    await store.create({
      id: "case-guarded",
      title: "Guarded",
      question: "Does the aggregate own its invariants?",
      tier: "lens",
      roomId: "room-1",
      kickoffMessageId: "kickoff-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      parentAgentId: "lead-1",
      roles: ["scout"],
    });

    await expect(
      store.assertSeatLaunch("case-guarded", "scout", "lead-1", "workspace-2"),
    ).rejects.toThrow("canonical workspace");
    await store.assignSeat({
      caseId: "case-guarded",
      role: "scout",
      agentId: "scout-1",
      parentAgentId: "lead-1",
      workspaceId: "workspace-1",
    });
    await store.recordSeat({
      caseId: "case-guarded",
      agentId: "scout-1",
      phase: "review",
      integrity: "missing",
    });
    await expect(
      store.recordSeat({
        caseId: "case-guarded",
        agentId: "scout-1",
        phase: "sealed",
        integrity: "missing",
      }),
    ).rejects.toThrow("cannot regress");
  });

  it("migrates only canonical legacy roles and preserves repeated case IDs across scopes", async () => {
    const store = new CouncilCaseStore({
      paseoHome: await createHome(),
      logger: createTestLogger(),
    });
    const records = [
      legacyAgent("scout-1", "workspace-1", "scout", "lead-1"),
      {
        ...legacyAgent("scout-2", "workspace-1", "scout", "lead-1"),
        createdAt: "2026-08-10T11:00:00.000Z",
      },
      legacyAgent("architect-1", "workspace-1", "architect", "lead-1"),
      legacyAgent("reviewer-2", "workspace-2", "reviewer", "lead-2"),
      legacyAgent("auditor-ignored", "workspace-2", "auditor", "lead-2"),
    ];

    await expect(
      store.migrateLegacyAgentLabels(
        records,
        new Map([
          ["workspace-1", "project-1"],
          ["workspace-2", "project-2"],
        ]),
      ),
    ).resolves.toBe(2);
    const cases = await store.list();
    expect(cases).toHaveLength(2);
    expect(cases.map((council) => council.scopeId).sort()).toEqual([
      "workspace:workspace-1",
      "workspace:workspace-2",
    ]);
    const roles = cases
      .flatMap((council) => council.seats)
      .map((seat) => seat.role)
      .sort();
    expect(roles).toEqual(["architect", "reviewer", "scout"]);
    expect(
      cases.find((council) => council.scopeId === "workspace:workspace-1")?.seats,
    ).toContainEqual(expect.objectContaining({ role: "scout", agentId: "scout-2" }));
    await expect(store.migrateLegacyAgentLabels(records, new Map())).resolves.toBe(0);
  });
});
