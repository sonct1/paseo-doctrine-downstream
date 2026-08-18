import { buildHostProjectIssuesRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

test.describe("Beads Central issue surface", () => {
  test.skip(
    !process.env.PASEO_BEADS_CENTRAL_SIDECAR || !process.env.PASEO_BEADS_CENTRAL_BD_BIN,
    "Requires the bundled Beads Central sidecar component for the isolated daemon.",
  );

  test("creates, reads, closes, and isolates project issue graphs", async ({
    page,
    e2eWorkerClient,
  }, testInfo) => {
    test.setTimeout(120_000);
    const daemonConfig = await e2eWorkerClient.getDaemonConfig();
    expect(daemonConfig.config.beadsCentral).toEqual({
      endpoint: "http://127.0.0.1:8080",
      credentialRef: "beads-central",
    });
    const first = await seedWorkspace({ repoPrefix: "beads-ui-one-" });
    const second = await seedWorkspace({ repoPrefix: "beads-ui-two-" });
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostProjectIssuesRoute(getServerId(), first.projectId));

      await expect(page.getByTestId("issues-screen")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("No issues yet", { exact: true })).toBeVisible();
      await expect(page.getByTestId("beads-central-configure-button")).toHaveCount(0);
      await page.getByTestId("issues-create-button").first().click();
      await page.getByTestId("issue-create-title").fill("Qualify Beads Central in Paseo");
      await page
        .getByTestId("issue-create-description")
        .fill("Exercise the Human WebUI against the daemon-owned project graph.");
      await page
        .getByTestId("issue-create-acceptance")
        .fill("Create, read, close, and prove cross-project isolation.");
      await page.getByRole("radio", { name: "Feature" }).click();
      await page.getByRole("radio", { name: "P1" }).click();
      await page.getByTestId("issue-create-submit").click();

      const detail = page.locator('[data-testid^="issue-detail-"]:visible');
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(
        detail.getByText("Qualify Beads Central in Paseo", { exact: true }),
      ).toBeVisible();
      await expect(
        detail.getByText("Exercise the Human WebUI against the daemon-owned project graph.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        detail.getByText("Create, read, close, and prove cross-project isolation.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(detail.getByText("Work state, not acceptance", { exact: true })).toBeVisible();
      await expect(detail.getByText("Feature", { exact: true })).toBeVisible();
      await expect(detail.getByText("P1", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "New issue" }).click();
      await page.getByTestId("issue-create-title").fill("Preserve close draft isolation");
      await page.getByTestId("issue-create-submit").click();
      await expect(detail.getByText("Preserve close draft isolation", { exact: true })).toBeVisible(
        {
          timeout: 30_000,
        },
      );

      const issuesList = page.locator('[data-testid="issues-list"]:visible');
      await expect(issuesList.getByTestId("issue-kanban-column-open")).toBeVisible();
      await expect(issuesList.getByTestId("issue-kanban-column-in_progress")).toBeVisible();
      await expect(issuesList.getByTestId("issue-kanban-column-blocked")).toBeVisible();
      await issuesList.getByRole("button", { name: /^Qualify Beads Central in Paseo,/u }).click();
      await detail.getByTestId("issue-close-button").click();
      await detail
        .getByTestId("issue-close-reason")
        .fill("This draft belongs only to the first selected issue.");
      await issuesList.getByRole("button", { name: /^Preserve close draft isolation,/u }).click();
      await expect(detail.getByTestId("issue-close-form")).toHaveCount(0);
      await expect(
        detail.getByText("Preserve close draft isolation", { exact: true }),
      ).toBeVisible();

      await issuesList.getByRole("button", { name: /^Qualify Beads Central in Paseo,/u }).click();
      await expect(detail.getByTestId("issue-close-form")).toHaveCount(0);
      await detail.getByTestId("issue-close-button").click();
      await detail
        .getByTestId("issue-close-reason")
        .fill("E2E evidence recorded; Human closes work state.");
      await detail.getByTestId("issue-close-confirm").click();
      await expect(detail.getByTestId("issue-status-closed")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        detail.getByText("E2E evidence recorded; Human closes work state.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Closed", exact: true }).click();
      await expect(issuesList.getByTestId("issue-kanban-column-closed")).toBeVisible();
      await expect(issuesList.getByTestId("issue-kanban-column-open")).toHaveCount(0);
      await expect(
        issuesList.getByRole("button", {
          name: /^Qualify Beads Central in Paseo, Closed,/u,
        }),
      ).toBeVisible();
      await expect(
        issuesList.getByRole("button", {
          name: /^Preserve close draft isolation,/u,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await expect(
        issuesList.getByRole("button", {
          name: /^Preserve close draft isolation, Open,/u,
        }),
      ).toBeVisible();
      await expect(
        issuesList.getByRole("button", {
          name: /^Qualify Beads Central in Paseo,/u,
        }),
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="issues-truncation-notice"]:visible')).toHaveCount(0);
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.screenshot({
        path: testInfo.outputPath("beads-issue-desktop.png"),
        animations: "disabled",
      });

      await page.goto(buildHostProjectIssuesRoute(getServerId(), second.projectId));
      await expect(
        page.getByText("No issues yet", { exact: true }).filter({ visible: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Qualify Beads Central in Paseo", { exact: true })).toHaveCount(
        0,
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(buildHostProjectIssuesRoute(getServerId(), first.projectId));
      await expect(page.getByTestId("issues-list")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("Qualify Beads Central in Paseo", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("beads-issue-compact.png"),
        animations: "disabled",
      });
      await expect(page.getByTestId("beads-central-configure-button")).toHaveCount(0);
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });
});
