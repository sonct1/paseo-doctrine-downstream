import { describe, expect, it } from "vitest";
import {
  FOUNDATION_HUB_STARTER_ADMISSION_ERROR,
  continueHubGuidedSetup,
  foundationHubStarterAuthoritySupported,
  runHubGuidedSetup,
  type HubGuidedSetupEnvironment,
} from "./init.js";

describe("Foundation Hub guided starter admission", () => {
  it("fails closed before touching login, daemon, Hub, or workspace state", async () => {
    const touched: string[] = [];
    const environment = {
      isInteractive: () => true,
      cwd: () => {
        touched.push("cwd");
        return "/workspace";
      },
    } as HubGuidedSetupEnvironment;

    expect(foundationHubStarterAuthoritySupported()).toBe(false);
    await expect(runHubGuidedSetup(environment)).rejects.toMatchObject({
      code: FOUNDATION_HUB_STARTER_ADMISSION_ERROR,
    });
    expect(touched).toEqual([]);
  });

  it("does not connect a daemon from interactive login continuation", async () => {
    const touched: string[] = [];
    const environment = {
      prompts: {
        confirm: async () => {
          touched.push("confirm");
          return true;
        },
      },
      daemon: {
        connect: async () => {
          touched.push("daemon");
        },
      },
    } as unknown as HubGuidedSetupEnvironment;

    await expect(continueHubGuidedSetup("https://hub.test", environment)).rejects.toMatchObject({
      code: FOUNDATION_HUB_STARTER_ADMISSION_ERROR,
    });
    expect(touched).toEqual([]);
  });
});
