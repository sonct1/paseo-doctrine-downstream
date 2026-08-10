import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AssignmentEnvelope } from "@getpaseo/protocol/assignment-contract";
import { buildHostCouncilRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

const CASE_ID = "phase6-dirty-review";
const CASE_TITLE = "Phase 6 dirty implementation review";

function leadAssignment(): AssignmentEnvelope {
  return {
    version: 1,
    disposition: "lead-direct",
    objective: "Run the bounded Council case.",
    effectClass: "read-only",
    mutationBoundary: { mode: "no-write" },
    externalEffectBoundary: { mode: "denied" },
    evidence: "Return the Council reports and Lead verdict.",
    handbackAndStop: "Stop after the binding verdict or a material blocker.",
  };
}

async function seedCouncilScenario() {
  const workspace = await seedWorkspace({ repoPrefix: "council-ui-" });
  try {
    const lead = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Council Lead",
      modeId: "load-test",
      model: "ten-second-stream",
      roleId: "lead",
      assignment: leadAssignment(),
    });
    const createSeat = (
      title: string,
      role: "independent" | "challenger" | "verifier" | "auditor",
      round: string,
    ) =>
      workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
        modeId: "load-test",
        model: "ten-second-stream",
        labels: {
          [PARENT_AGENT_ID_LABEL]: lead.id,
          "council.case_id": CASE_ID,
          "council.title": CASE_TITLE,
          "council.tier": "high-risk",
          "council.phase": "verdict",
          "council.role": role,
          "council.round": round,
        },
      });

    const seats = await Promise.all([
      createSeat("Independent", "independent", "1"),
      createSeat("Premise Challenger", "challenger", "1"),
      createSeat("Verifier", "verifier", "verify"),
      createSeat("Auditor", "auditor", "audit"),
    ]);
    return {
      leadId: lead.id,
      seatIds: seats.map((seat) => seat.id),
      cleanup: workspace.cleanup,
    };
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

test.describe("Council case surface", () => {
  test("projects labeled seats at desktop and compact viewports", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = await seedCouncilScenario();
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), CASE_ID));

      const detail = page.getByTestId(`council-detail-${CASE_ID}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText(CASE_TITLE, { exact: true })).toBeVisible();
      await expect(
        page.getByText("One accountable Lead. Independent seats. No vote."),
      ).toBeVisible();
      await expect(page.getByTestId(`council-row-phase-${CASE_ID}`)).toContainText(
        "Lead-linked verdict marker",
      );
      await expect(page.getByTestId("council-phase-rail")).toContainText(
        "Lead-linked verdict marker",
      );
      await expect(
        page
          .getByTestId("council-verdict-summary")
          .getByText("Lead-linked verdict marker", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Seat labels indicate verdict, and the case link resolves to a daemon-bound Lead. Open the Lead timeline to verify the binding decision and handoff contract before relying on it.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.locator('[data-testid^="council-open-agent-"]')).toHaveCount(4);
      await expect(page.getByTestId("councils-list")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("council-desktop.png"),
        animations: "disabled",
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("councils-list")).toHaveCount(0);
      await expect(page.getByText("Seats", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("council-compact.png"),
        animations: "disabled",
      });
    } finally {
      await scenario.cleanup();
    }
  });
});
