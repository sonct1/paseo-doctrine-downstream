import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AssignmentEnvelope } from "@getpaseo/protocol/assignment-contract";
import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

function assignmentFor(roleId: PaseoRoleId, issueIds: string[] = []): AssignmentEnvelope {
  const disposition = {
    lead: "lead-direct",
    peer: "peer-execution",
    supervisor: "supervision",
  } as const;
  return {
    version: 1,
    disposition: disposition[roleId],
    objective: `Exercise the ${roleId} topology projection.`,
    effectClass: "read-only",
    mutationBoundary: { mode: "no-write" },
    externalEffectBoundary: { mode: "denied" },
    evidence: "Expose the daemon-issued role and relationship in the workspace topology.",
    handbackAndStop: "Stop after topology verification or a material blocker.",
    ...(issueIds.length > 0 ? { resourceGrants: { beadsIssueIds: issueIds } } : {}),
  };
}

test.describe("workspace topology", () => {
  test("projects daemon-bound roles and opens an agent from the graph", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "topology-e2e-" });
    try {
      const lead = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Topology Lead",
        modeId: "load-test",
        model: "ten-second-stream",
        roleId: "lead",
        assignment: assignmentFor("lead"),
      });
      const peer = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Topology Peer",
        modeId: "load-test",
        model: "ten-second-stream",
        roleId: "peer",
        assignment: assignmentFor("peer", ["ps-topology-e2e"]),
        labels: { [PARENT_AGENT_ID_LABEL]: lead.id },
      });
      await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Topology Supervisor",
        modeId: "load-test",
        model: "ten-second-stream",
        roleId: "supervisor",
        assignment: assignmentFor("supervisor"),
      });

      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      await expect(page.getByTestId("workspace-header-topology")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("workspace-header-issues")).toBeVisible();
      await page.getByTestId("workspace-header-topology").click();

      const topology = page.getByTestId("workspace-topology-panel");
      await expect(topology).toBeVisible({ timeout: 30_000 });
      await expect(topology.getByText("3 agents · 2 relationships", { exact: true })).toBeVisible();
      await expect(topology.getByLabel(/Open Topology Lead, lead,/u)).toBeVisible();
      await expect(topology.getByLabel(/Open Topology Peer, peer,/u)).toBeVisible();
      await expect(topology.getByLabel(/Open Topology Supervisor, supervisor,/u)).toBeVisible();
      await expect(topology.getByText("delegates", { exact: true })).toBeVisible();
      await expect(topology.getByText("observes · inferred", { exact: true })).toBeVisible();
      await expect(topology.getByText("1 assigned issue", { exact: true })).toBeVisible();
      await expect(topology.getByText("ps-topology-e2e", { exact: true })).toBeVisible();

      await topology.getByLabel(/Open Topology Peer, peer,/u).click();
      await expect(page.getByTestId(`workspace-tab-agent_${peer.id}`).first()).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("workspace-header-issues").click();
      await expect(page.getByTestId("issues-screen")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await workspace.cleanup();
    }
  });
});
