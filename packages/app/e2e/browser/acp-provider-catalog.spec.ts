import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  openAddProviderArea,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

const ACP_PROVIDER = {
  id: "hermes",
  name: "Hermes",
};

test.describe("ACP provider catalog", () => {
  test("does not offer unsupported catalog providers", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, getServerId());
    await openSettingsHostSection(page, getServerId(), "providers");
    await openAddProviderArea(page);

    await page.getByRole("textbox", { name: "Search providers" }).fill(ACP_PROVIDER.name);
    await expect(page.getByText(ACP_PROVIDER.name, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId(`install-provider-${ACP_PROVIDER.id}`)).toHaveCount(0);
  });
});
