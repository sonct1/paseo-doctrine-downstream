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

async function seedCouncilScenario(caseTitle = CASE_TITLE, options: { integrity?: string } = {}) {
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
          "council.title": caseTitle,
          "council.tier": "high-risk",
          "council.phase": "verdict",
          "council.role": role,
          "council.round": round,
          ...(options.integrity
            ? {
                "council.integrity": options.integrity,
                "council.room_id": "room-browser-fixture",
                "council.kickoff_message_id": "kickoff-browser-fixture",
                "council.report_message_id": `report-${role}-${round}`,
                "council.report_digest": "d".repeat(64),
                "council.report_created_at": "2026-08-10T10:00:00.000Z",
                "council.report_start_sentinel": `${role.toUpperCase()}_COUNCIL_REPORT_V1`,
                "council.report_end_sentinel": `${role.toUpperCase()}_COUNCIL_REPORT_END`,
              }
            : {}),
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
      workspaceId: workspace.workspaceId,
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
    const scenario = await seedCouncilScenario(CASE_TITLE, {
      integrity: "valid-browser-report",
    });
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), CASE_ID, scenario.workspaceId));

      const detail = page.getByTestId(`council-detail-${CASE_ID}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText(CASE_TITLE, { exact: true })).toBeVisible();
      await expect(
        page.getByText("One accountable Lead. Architect + Reviewer. No vote."),
      ).toBeVisible();
      await expect(
        page.getByTestId(`council-row-phase-${CASE_ID}-${scenario.workspaceId}`),
      ).toContainText("Lead-linked verdict marker");
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

  test("does not call a finished but unaudited seat report ready", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await seedCouncilScenario();
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), CASE_ID, scenario.workspaceId));

      const detail = page.getByTestId(`council-detail-${CASE_ID}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText("Awaiting Lead audit", { exact: true })).toHaveCount(4);
      await expect(detail.getByText("Report ready", { exact: true })).toHaveCount(0);
      await expect(
        detail.getByText(
          "The seat finished, but the Lead has not marked its report as valid. Inspect the timeline before counting it.",
          { exact: true },
        ),
      ).toHaveCount(4);
    } finally {
      await scenario.cleanup();
    }
  });

  test("keeps same-ID cases isolated across workspaces", async ({ page }) => {
    test.setTimeout(120_000);
    const first = await seedCouncilScenario("Workspace one Council");
    const second = await seedCouncilScenario("Workspace two Council");
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), CASE_ID));
      await expect(page.getByText("Choose a workspace", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId(`council-row-${CASE_ID}-${first.workspaceId}`)).toBeVisible();
      await expect(page.getByTestId(`council-row-${CASE_ID}-${second.workspaceId}`)).toBeVisible();

      await page.goto(buildHostCouncilRoute(getServerId(), CASE_ID, second.workspaceId));

      const detail = page.getByTestId(`council-detail-${CASE_ID}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText("Workspace two Council", { exact: true })).toBeVisible();
      await expect(detail.getByText("Workspace one Council", { exact: true })).toHaveCount(0);
      await expect(detail.locator('[data-testid^="council-open-agent-"]')).toHaveCount(4);
      const list = page.getByTestId("councils-list");
      await expect(list.getByText("Workspace one Council", { exact: true })).toBeVisible();
      await expect(list.getByText("Workspace two Council", { exact: true })).toBeVisible();
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });
});
