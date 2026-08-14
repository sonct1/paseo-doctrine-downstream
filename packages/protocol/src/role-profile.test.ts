import { describe, expect, test } from "vitest";

import {
  RoleProfileLaunchDefaultsSchema,
  RoleProfilePreferencesMapSchema,
} from "./role-profile.js";

describe("role profile protocol", () => {
  test("accepts provider-neutral host preferences", () => {
    expect(
      RoleProfilePreferencesMapSchema.parse({
        lead: {
          defaults: {
            provider: "codex-proxy",
            model: "gpt-5.4",
            modeId: "default",
            thinkingOptionId: "high",
          },
          allowedTools: ["create_agent", "beads_status"],
          allowedSkills: ["beads-issue-tracker"],
        },
      }),
    ).toMatchObject({ lead: { defaults: { provider: "codex-proxy" } } });
  });

  test("requires a provider for nested defaults and rejects duplicates", () => {
    expect(() => RoleProfileLaunchDefaultsSchema.parse({ model: "gpt-5.4" })).toThrow(
      "require a provider",
    );
    expect(() =>
      RoleProfilePreferencesMapSchema.parse({
        peer: { allowedTools: ["beads_status", "beads_status"] },
      }),
    ).toThrow("Entries must be unique");
  });
});
