import type { PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type { RoleProfileCatalog } from "@getpaseo/protocol/role-profile";

export interface RoleOption {
  id: PaseoRoleId;
  label: string;
  description: string;
}

/**
 * COMPAT(pre-bundled-slp-daemons): old daemons expose role binding but not the
 * generation-pinned role profile catalog. New daemons must use the catalog and
 * never fall back here when bundled SLP loading fails.
 */
export const LEGACY_CORE_ROLE_OPTIONS = [
  {
    id: "lead",
    label: "Lead",
    description:
      "Owns routing, integration, engineering decisions, and acceptance. Reads the full Workspace Protocol.",
  },
  {
    id: "peer",
    label: "Peer",
    description:
      "Owns independent technical judgment inside one bounded assignment. Receives only relevant protocol constraints.",
  },
  {
    id: "supervisor",
    label: "Supervisor",
    description:
      "Observes orchestration and advises Human without becoming a super-Lead. Reads protocol only under a governance mandate.",
  },
] as const satisfies ReadonlyArray<RoleOption>;

export function resolveRoleOptions(
  catalog: RoleProfileCatalog | null,
  roleProfilesSupported: boolean,
): ReadonlyArray<RoleOption> {
  if (catalog) {
    return catalog.profiles.map((profile) => ({
      id: profile.roleId,
      label: profile.label,
      description: profile.description,
    }));
  }
  return roleProfilesSupported ? [] : LEGACY_CORE_ROLE_OPTIONS;
}

export function legacyCoreRoleLabel(roleId: PaseoRoleId): string {
  return LEGACY_CORE_ROLE_OPTIONS.find((role) => role.id === roleId)?.label ?? roleId;
}
