import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  openAddProviderArea,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

const UNQUALIFIED_ACP_PROVIDERS = [
  { id: "minimax-code", name: "MiniMax Code" },
  { id: "fast-agent", name: "fast-agent" },
  { id: "hermes", name: "Hermes" },
] as const;

test.describe("ACP provider catalog", () => {
  test("does not offer ACP providers that Foundation has not qualified", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, getServerId());
    await openSettingsHostSection(page, getServerId(), "providers");
    await openAddProviderArea(page);

    const search = page.getByRole("textbox", { name: "Search providers" });
    for (const provider of UNQUALIFIED_ACP_PROVIDERS) {
      await search.fill(provider.name);
      await expect(page.getByText(provider.name, { exact: true })).toHaveCount(0);
      await expect(page.getByTestId(`install-provider-${provider.id}`)).toHaveCount(0);
    }
  });
});
