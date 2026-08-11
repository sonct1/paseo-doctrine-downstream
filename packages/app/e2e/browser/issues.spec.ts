import { buildHostProjectIssuesRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

test.describe("Native Beads issue surface", () => {
  test.skip(
    !process.env.PASEO_BEADS_BINARY,
    "Requires an explicitly pinned native Beads binary for the isolated daemon.",
  );

  test("creates, reads, closes, and isolates project issue graphs", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const first = await seedWorkspace({ repoPrefix: "beads-ui-one-" });
    const second = await seedWorkspace({ repoPrefix: "beads-ui-two-" });
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostProjectIssuesRoute(getServerId(), first.projectId));

      await expect(page.getByTestId("issues-screen")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("No issues yet", { exact: true })).toBeVisible();
      await page.getByTestId("issues-create-button").first().click();
      await page.getByTestId("issue-create-title").fill("Qualify native Beads in Paseo");
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
        detail.getByText("Qualify native Beads in Paseo", { exact: true }),
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

      const issuesList = page.getByTestId("issues-list");
      await issuesList.getByRole("button", { name: /^Qualify native Beads in Paseo,/u }).click();
      await detail.getByTestId("issue-close-button").click();
      await detail
        .getByTestId("issue-close-reason")
        .fill("This draft belongs only to the first selected issue.");
      await issuesList.getByRole("button", { name: /^Preserve close draft isolation,/u }).click();
      await expect(detail.getByTestId("issue-close-form")).toHaveCount(0);
      await expect(
        detail.getByText("Preserve close draft isolation", { exact: true }),
      ).toBeVisible();

      await issuesList.getByRole("button", { name: /^Qualify native Beads in Paseo,/u }).click();
      await expect(detail.getByTestId("issue-close-form")).toHaveCount(0);
      await detail.getByTestId("issue-close-button").click();
      await detail
        .getByTestId("issue-close-reason")
        .fill("E2E evidence recorded; Human closes work state.");
      await detail.getByTestId("issue-close-confirm").click();
      await expect(detail.getByTestId("issue-status-closed")).toBeVisible({ timeout: 30_000 });
      await expect(
        detail.getByText("E2E evidence recorded; Human closes work state.", { exact: true }),
      ).toBeVisible();
      const visibleIssuesList = page.locator('[data-testid="issues-list"]:visible');
      await page.getByRole("button", { name: "Closed", exact: true }).click();
      await expect(
        visibleIssuesList.getByRole("button", {
          name: /^Qualify native Beads in Paseo, Closed,/u,
        }),
      ).toBeVisible();
      await expect(
        visibleIssuesList.getByRole("button", { name: /^Preserve close draft isolation,/u }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await expect(
        visibleIssuesList.getByRole("button", {
          name: /^Preserve close draft isolation, Open,/u,
        }),
      ).toBeVisible();
      await expect(
        visibleIssuesList.getByRole("button", { name: /^Qualify native Beads in Paseo,/u }),
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
      await expect(page.getByText("Qualify native Beads in Paseo", { exact: true })).toHaveCount(0);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(buildHostProjectIssuesRoute(getServerId(), first.projectId));
      await expect(page.getByTestId("issues-list")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Qualify native Beads in Paseo", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("beads-issue-compact.png"),
        animations: "disabled",
      });
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });
});
