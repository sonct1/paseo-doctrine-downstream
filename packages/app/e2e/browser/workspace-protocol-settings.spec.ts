import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProjectSettingsRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

test.describe("optional Workspace Protocol settings", () => {
  test("previews and creates a protocol only when the Human chooses bootstrap", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "protocol-settings-e2e-" });
    const protocolPath = path.join(workspace.repoPath, "WORKSPACE_PROTOCOL.md");
    try {
      await expect(readFile(protocolPath, "utf8")).rejects.toThrow();

      await page.goto(
        buildProjectSettingsRoute(getServerId(), workspace.projectId, {
          protocolRoot: workspace.repoPath,
        }),
      );

      await expect(page.getByTestId("workspace-protocol-missing")).toBeVisible({ timeout: 30_000 });
      const editor = page.getByTestId("workspace-protocol-input");
      await expect(editor).toHaveValue(/PASEO_WORKSPACE_PROTOCOL_VERSION: 3/u);

      await page.getByTestId("workspace-protocol-save").click();
      await expect(page.getByTestId("workspace-protocol-missing")).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(page.getByTestId("workspace-protocol-editor-section")).toBeVisible();

      const persisted = await readFile(protocolPath, "utf8");
      expect(persisted).toContain("PASEO_WORKSPACE_PROTOCOL_VERSION: 3");
    } finally {
      await workspace.cleanup();
    }
  });
});
