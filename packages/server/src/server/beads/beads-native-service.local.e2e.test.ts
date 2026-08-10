import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { BeadsNativeService } from "./beads-native-service.js";

const binaryPath = process.env.PASEO_BEADS_BINARY?.trim();

describe.skipIf(!binaryPath)("BeadsNativeService with pinned bd", () => {
  let paseoHome = "";
  let service: BeadsNativeService;

  beforeAll(async () => {
    paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-beads-native-real-"));
    service = new BeadsNativeService({
      paseoHome,
      logger: createTestLogger(),
      binaryPath,
    });
  });

  afterAll(async () => {
    await rm(paseoHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("round-trips two isolated project graphs with real claim, dependency, update, and close", async () => {
    await expect(service.status()).resolves.toEqual({ available: true, version: "1.1.2" });
    const leadA = { projectId: "project-a", actor: "paseo-agent-lead-a" };
    const peerA = { projectId: "project-a", actor: "paseo-agent-peer-a" };
    const leadB = { projectId: "project-b", actor: "paseo-agent-lead-b" };
    const untouched = { projectId: "project-empty", actor: "paseo-agent-supervisor" };

    await expect(service.list(untouched, { limit: 20 })).resolves.toEqual([]);
    await expect(service.get(untouched, "missing-issue")).rejects.toThrow("is not initialized");

    const first = await service.create(leadA, {
      title: "Project A implementation",
      description: "Real native Beads round trip",
      issueType: "feature",
      priority: 1,
      idempotencyKey: "create-project-a-implementation",
    });
    const replay = await service.create(leadA, {
      title: "Project A implementation",
      description: "Real native Beads round trip",
      issueType: "feature",
      priority: 1,
      idempotencyKey: "create-project-a-implementation",
    });
    expect(replay.id).toBe(first.id);

    const verification = await service.create(leadA, {
      title: "Project A verification",
      issueType: "task",
      priority: 2,
      idempotencyKey: "create-project-a-verification",
    });
    await service.addDependency(
      leadA,
      verification.id,
      first.id,
      "blocks",
      "verification-depends-on-implementation",
    );

    const claimed = await service.claim(peerA, first.id, "peer-a-claim");
    expect(claimed).toMatchObject({ status: "in_progress", assignee: peerA.actor });
    const blocked = await service.update(peerA, first.id, {
      status: "blocked",
      appendNotes: "Waiting for a Human decision",
      idempotencyKey: "peer-a-blocked",
    });
    expect(blocked.status).toBe("blocked");
    const closed = await service.close(
      leadA,
      first.id,
      "Decision supplied and evidence accepted",
      "lead-a-close",
    );
    expect(closed.status).toBe("closed");
    await expect(
      service.claim(peerA, first.id, "peer-a-closed-reclaim", undefined, {
        kind: "claim",
        issueId: first.id,
        actor: peerA.actor,
        requireNotClosed: true,
      }),
    ).rejects.toThrow(`cannot claim closed issue ${first.id}`);
    await expect(service.get(leadA, first.id)).resolves.toMatchObject({
      status: "closed",
      assignee: peerA.actor,
    });

    const ownership = await service.create(leadA, {
      title: "Project A ownership guard",
      issueType: "task",
      priority: 2,
      idempotencyKey: "create-project-a-ownership-guard",
    });
    await service.claim(peerA, ownership.id, "peer-a-ownership-claim", undefined, {
      kind: "claim",
      issueId: ownership.id,
      actor: peerA.actor,
      requireNotClosed: true,
    });
    const peerB = { projectId: "project-a", actor: "paseo-agent-peer-b" };
    await expect(
      service.claim(peerB, ownership.id, "peer-b-ownership-steal", undefined, {
        kind: "claim",
        issueId: ownership.id,
        actor: peerB.actor,
        requireNotClosed: true,
      }),
    ).rejects.toThrow(`cannot claim issue ${ownership.id} assigned to ${peerA.actor}`);
    await expect(service.get(leadA, ownership.id)).resolves.toMatchObject({
      status: "in_progress",
      assignee: peerA.actor,
    });

    const otherProject = await service.create(leadB, {
      title: "Project B implementation",
      issueType: "feature",
      priority: 1,
      idempotencyKey: "create-project-b-implementation",
    });
    const projectA = await service.list(leadA, { limit: 20 });
    const projectB = await service.list(leadB, { limit: 20 });
    expect(projectA.map((issue) => issue.id)).toContain(first.id);
    expect(projectA.map((issue) => issue.id)).not.toContain(otherProject.id);
    expect(projectB.map((issue) => issue.id)).toEqual([otherProject.id]);
    await expect(service.prime(leadA)).resolves.toContain("Beads Workflow Context");
  }, 60_000);
});
