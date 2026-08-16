import { describe, expect, test } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import type { RoleProfilePreferencesMap } from "@getpaseo/protocol/role-profile";
import { RoleDefaultProfileMigration } from ".";

class FakeRoleDefaultHost {
  readonly patches: Array<{
    agentProfiles: AgentProfile[];
    roleProfiles: RoleProfilePreferencesMap;
  }> = [];

  config: {
    agentProfiles?: AgentProfile[];
    roleProfiles?: RoleProfilePreferencesMap;
  } = {
    agentProfiles: [],
    roleProfiles: {
      lead: {
        defaults: {
          provider: "codex",
          model: "gpt-5.4",
          modeId: "read-only",
          thinkingOptionId: "high",
        },
        allowedTools: ["list_profiles", "create_agent"],
      },
      peer: { allowedSkills: ["beads-issue-tracker"] },
    },
  };
  supported = true;

  getLastServerInfoMessage() {
    return {
      features: this.supported
        ? { agentProfiles: true, agentConfigApply: true }
        : { agentProfiles: false, agentConfigApply: false },
    };
  }

  async getDaemonConfig() {
    return { config: this.config };
  }

  async patchDaemonConfig(patch: {
    agentProfiles: AgentProfile[];
    roleProfiles: RoleProfilePreferencesMap;
  }) {
    this.patches.push(patch);
    this.config = { ...this.config, ...patch };
    return { config: this.config };
  }
}

describe("legacy role launch-default migration", () => {
  test("moves route fields into an Agent Profile and preserves role capability preferences", async () => {
    const host = new FakeRoleDefaultHost();
    const migration = new RoleDefaultProfileMigration();

    await migration.migrateHost("host-a", host);

    expect(host.patches).toEqual([
      {
        agentProfiles: [
          {
            id: "legacy_role_default:lead",
            name: "Lead · migrated launch preset",
            provider: "codex",
            model: "gpt-5.4",
            modeId: "read-only",
            thinkingOptionId: "high",
            notes:
              "Audience: lead\nSource: migrated SLP role launch defaults.\nAuthority: none; exact role binding and assignment remain required.",
          },
        ],
        roleProfiles: {
          lead: { allowedTools: ["list_profiles", "create_agent"] },
        },
      },
    ]);
  });

  test("reuses an equivalent Human preset and remains idempotent", async () => {
    const host = new FakeRoleDefaultHost();
    const existing: AgentProfile = {
      id: "human-lead-route",
      name: "Lead route",
      provider: "codex",
      model: "gpt-5.4",
      modeId: "read-only",
      thinkingOptionId: "high",
    };
    host.config.agentProfiles = [existing];
    const migration = new RoleDefaultProfileMigration();

    await migration.migrateHost("host-a", host);
    await migration.migrateHost("host-a", host);

    expect(host.patches).toEqual([
      {
        agentProfiles: [existing],
        roleProfiles: {
          lead: { allowedTools: ["list_profiles", "create_agent"] },
        },
      },
    ]);
  });

  test("waits until the host advertises Agent Profile support", async () => {
    const host = new FakeRoleDefaultHost();
    host.supported = false;
    const migration = new RoleDefaultProfileMigration();

    await migration.migrateHost("host-a", host);
    host.supported = true;
    await migration.migrateHost("host-a", host);

    expect(host.patches).toHaveLength(1);
  });
});
