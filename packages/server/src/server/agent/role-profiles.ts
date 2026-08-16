import { createHash } from "node:crypto";

import {
  PASEO_ROLE_IDS,
  PASEO_ROLE_SUMMARIES,
  type PaseoRoleId,
  type RoleProfileBindingReceipt,
} from "@getpaseo/protocol/role-binding";
import {
  RoleProfileCatalogSchema,
  RoleProfilePreferencesMapSchema,
  RoleProfilePreferencesSchema,
  type RoleProfileCatalog,
  type RoleProfilePreferences,
  type RoleProfilePreferencesMap,
} from "@getpaseo/protocol/role-profile";

import { getFoundationRoleDefinition } from "./foundation-role-definitions.js";
import { loadFoundationSkillPolicy } from "./foundation-skill-policy.js";

export const ROLE_TOOL_CEILINGS = {
  lead: [
    "list_workspaces",
    "list_workspace_scripts",
    "list_profiles",
    "create_agent",
    "send_agent_prompt",
    "signal_agent",
    "prepare_lead_handoff",
    "transition_lead_handoff",
    "resolve_agent_signal",
    "get_agent_status",
    "list_agents",
    "cancel_agent",
    "archive_agent",
    "get_agent_activity",
    "create_room",
    "read_room",
    "post_room",
    "beads_status",
    "beads_ready",
    "beads_list",
    "beads_get",
    "beads_create",
    "beads_claim",
    "beads_update",
    "beads_close",
    "beads_add_dependency",
    "beads_prime",
    "list_providers",
    "list_models",
    "inspect_provider",
  ],
  peer: [
    "post_room",
    "beads_status",
    "beads_ready",
    "beads_list",
    "beads_get",
    "beads_create",
    "beads_claim",
    "beads_update",
    "beads_add_dependency",
    "beads_prime",
  ],
  supervisor: [
    "list_workspaces",
    "list_workspace_scripts",
    "get_agent_status",
    "list_agents",
    "get_agent_activity",
    "list_pending_permissions",
    "list_terminals",
    "capture_terminal",
    "list_schedules",
    "inspect_schedule",
    "schedule_logs",
    "list_providers",
    "list_models",
    "inspect_provider",
    "signal_agent",
    "resolve_agent_signal",
    "beads_status",
    "beads_ready",
    "beads_list",
    "beads_get",
    "beads_prime",
  ],
} as const satisfies Record<PaseoRoleId, readonly string[]>;

export const MANDATORY_ROLE_TOOLS = ["beads_status", "beads_get", "beads_prime"] as const;
export const MANDATORY_ROLE_SKILLS = ["beads-issue-tracker"] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertSelectionWithinCeiling(input: {
  roleId: PaseoRoleId;
  kind: "tool" | "skill";
  selected: readonly string[];
  ceiling: readonly string[];
  mandatory: readonly string[];
}): void {
  const ceiling = new Set(input.ceiling);
  const unknown = input.selected.filter((entry) => !ceiling.has(entry));
  if (unknown.length > 0) {
    throw new Error(
      `Role profile '${input.roleId}' cannot enable ${input.kind}(s) outside the Foundation ceiling: ${unknown.join(", ")}`,
    );
  }
  const selected = new Set(input.selected);
  const missing = input.mandatory.filter((entry) => !selected.has(entry));
  if (missing.length > 0) {
    throw new Error(
      `Role profile '${input.roleId}' cannot disable mandatory ${input.kind}(s): ${missing.join(", ")}`,
    );
  }
}

function canonicalSelection(
  configured: readonly string[] | undefined,
  ceiling: readonly string[],
): string[] {
  if (!configured) return [...ceiling];
  const selected = new Set(configured);
  return ceiling.filter((entry) => selected.has(entry));
}

function roleSkillCeiling(roleId: PaseoRoleId): string[] {
  const policy = loadFoundationSkillPolicy(roleId);
  if (policy.status !== "bound") {
    throw new Error(
      `foundation_skill_admission_required: role bundle is ${policy.status} at ${policy.manifestPath}`,
    );
  }
  return [...policy.enabledNames].sort();
}

export function materializeRoleProfileBindingReceipt(
  roleId: PaseoRoleId,
  input: RoleProfilePreferences | undefined,
): RoleProfileBindingReceipt {
  const preferences = RoleProfilePreferencesSchema.parse(input ?? {});
  const toolCeiling = ROLE_TOOL_CEILINGS[roleId];
  const skillCeiling = roleSkillCeiling(roleId);
  const allowedTools = canonicalSelection(preferences.allowedTools, toolCeiling);
  const allowedSkills = canonicalSelection(preferences.allowedSkills, skillCeiling);

  assertSelectionWithinCeiling({
    roleId,
    kind: "tool",
    selected: preferences.allowedTools ?? allowedTools,
    ceiling: toolCeiling,
    mandatory: MANDATORY_ROLE_TOOLS,
  });
  assertSelectionWithinCeiling({
    roleId,
    kind: "skill",
    selected: preferences.allowedSkills ?? allowedSkills,
    ceiling: skillCeiling,
    mandatory: MANDATORY_ROLE_SKILLS,
  });

  const defaults = preferences.defaults ?? {};
  const canonical = JSON.stringify({
    schemaVersion: 1,
    roleId,
    defaults,
    allowedTools,
    allowedSkills,
  });
  return {
    schemaVersion: 1,
    profileDigest: sha256(canonical),
    defaults,
    allowedTools,
    allowedSkills,
  };
}

export function validateRoleProfilePreferencesMap(
  input: RoleProfilePreferencesMap,
): RoleProfilePreferencesMap {
  const parsed = RoleProfilePreferencesMapSchema.parse(input);
  for (const roleId of PASEO_ROLE_IDS) {
    if (parsed[roleId]) {
      materializeRoleProfileBindingReceipt(roleId, parsed[roleId]);
    }
  }
  return parsed;
}

export function buildRoleProfileCatalog(input: RoleProfilePreferencesMap): RoleProfileCatalog {
  const preferences = validateRoleProfilePreferencesMap(input);
  return RoleProfileCatalogSchema.parse({
    profiles: PASEO_ROLE_IDS.map((roleId) => {
      const definition = getFoundationRoleDefinition(roleId);
      const summary = PASEO_ROLE_SUMMARIES.find((entry) => entry.id === roleId);
      if (!summary) throw new Error(`Missing role summary for '${roleId}'`);
      const rolePreferences = preferences[roleId] ?? {};
      return {
        roleId,
        label: summary.label,
        description: summary.description,
        definitionVersion: definition.version,
        definitionDigest: sha256(definition.instructions),
        instructions: definition.instructions,
        toolCeiling: [...ROLE_TOOL_CEILINGS[roleId]],
        mandatoryTools: [...MANDATORY_ROLE_TOOLS],
        skillCeiling: roleSkillCeiling(roleId),
        mandatorySkills: [...MANDATORY_ROLE_SKILLS],
        preferences: rolePreferences,
        effective: materializeRoleProfileBindingReceipt(roleId, rolePreferences),
      };
    }),
  });
}
