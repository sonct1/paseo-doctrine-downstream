import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { PASEO_ROLE_SUMMARIES, type PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type {
  RoleProfileLaunchDefaults,
  RoleProfilePreferences,
  RoleProfilePreferencesMap,
} from "@getpaseo/protocol/role-profile";
import { FormPreferencesSchema } from "@/create-agent-preferences/preferences";
import { readValidatedJson, readValidatedString } from "@/storage/validated-storage";

const PREFERENCES_KEY = "@paseo:create-agent-preferences";
const COMPLETION_KEY_PREFIX = "@paseo:legacy-favorites-to-agent-profiles:v1:";
const CATALOG_LOADING_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 4_000] as const;

type LegacyFavorite = NonNullable<z.infer<typeof FormPreferencesSchema>["favoriteModels"]>[number];

export interface LegacyFavoriteMigrationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LegacyFavoriteMigrationHost {
  getLastServerInfoMessage(): {
    features?: { agentProfiles?: boolean; agentConfigApply?: boolean };
  } | null;
  getDaemonConfig(): Promise<{ config: { agentProfiles?: AgentProfile[] } }>;
  patchDaemonConfig(patch: {
    agentProfiles: AgentProfile[];
  }): Promise<{ config: { agentProfiles?: AgentProfile[] } }>;
  getProvidersSnapshot(): Promise<{ entries: ProviderSnapshotEntry[] }>;
}

function supportsMigration(host: {
  getLastServerInfoMessage(): {
    features?: { agentProfiles?: boolean; agentConfigApply?: boolean };
  } | null;
}): boolean {
  const features = host.getLastServerInfoMessage()?.features;
  return features?.agentProfiles === true && features.agentConfigApply === true;
}

export interface RoleDefaultProfileMigrationHost {
  getLastServerInfoMessage(): {
    features?: { agentProfiles?: boolean; agentConfigApply?: boolean };
  } | null;
  getDaemonConfig(): Promise<{
    config: {
      agentProfiles?: AgentProfile[];
      roleProfiles?: RoleProfilePreferencesMap;
    };
  }>;
  patchDaemonConfig(patch: {
    agentProfiles: AgentProfile[];
    roleProfiles: RoleProfilePreferencesMap;
  }): Promise<{
    config: {
      agentProfiles?: AgentProfile[];
      roleProfiles?: RoleProfilePreferencesMap;
    };
  }>;
}

function roleDefaultSelectionKey(defaults: RoleProfileLaunchDefaults): string {
  return JSON.stringify({
    provider: defaults.provider ?? "",
    model: defaults.model ?? "",
    modeId: defaults.modeId ?? "",
    thinkingOptionId: defaults.thinkingOptionId ?? "",
  });
}

function agentProfileSelectionKey(profile: AgentProfile): string {
  return roleDefaultSelectionKey({
    provider: profile.provider,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.modeId ? { modeId: profile.modeId } : {}),
    ...(profile.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId } : {}),
  });
}

function withoutRoleDefaults(preferences: RoleProfilePreferences): RoleProfilePreferences {
  const { defaults: _legacyDefaults, ...capabilities } = preferences;
  return capabilities;
}

function migratedRoleDefaultProfile(input: {
  roleId: PaseoRoleId;
  defaults: RoleProfileLaunchDefaults;
}): AgentProfile {
  const label =
    PASEO_ROLE_SUMMARIES.find((role) => role.id === input.roleId)?.label ?? input.roleId;
  return {
    id: `legacy_role_default:${input.roleId}`,
    name: `${label} · migrated launch preset`,
    provider: input.defaults.provider ?? "",
    ...(input.defaults.model ? { model: input.defaults.model } : {}),
    ...(input.defaults.modeId ? { modeId: input.defaults.modeId } : {}),
    ...(input.defaults.thinkingOptionId
      ? { thinkingOptionId: input.defaults.thinkingOptionId }
      : {}),
    notes:
      `Audience: ${input.roleId}\n` +
      "Source: migrated SLP role launch defaults.\n" +
      "Authority: none; exact role binding and assignment remain required.",
  };
}

/** Moves deprecated route defaults out of standing role preferences in one host config patch. */
export class RoleDefaultProfileMigration {
  private readonly inFlight = new Map<string, Promise<void>>();

  migrateHost(serverId: string, host: RoleDefaultProfileMigrationHost): Promise<void> {
    const active = this.inFlight.get(serverId);
    if (active) {
      return active;
    }
    const migration = this.run(host).finally(() => {
      if (this.inFlight.get(serverId) === migration) {
        this.inFlight.delete(serverId);
      }
    });
    this.inFlight.set(serverId, migration);
    return migration;
  }

  private async run(host: RoleDefaultProfileMigrationHost): Promise<void> {
    if (!supportsMigration(host)) {
      return;
    }
    const { config } = await host.getDaemonConfig();
    const roleProfiles = config.roleProfiles ?? {};
    const existingProfiles = config.agentProfiles ?? [];
    const existingSelections = new Set(existingProfiles.map(agentProfileSelectionKey));
    const existingIds = new Set(existingProfiles.map((profile) => profile.id));
    const migratedProfiles: AgentProfile[] = [];
    const roleProfilesPatch: RoleProfilePreferencesMap = {};

    for (const summary of PASEO_ROLE_SUMMARIES) {
      const preferences = roleProfiles[summary.id];
      const defaults = preferences?.defaults;
      if (!preferences || !defaults?.provider) {
        continue;
      }
      roleProfilesPatch[summary.id] = withoutRoleDefaults(preferences);
      if (existingSelections.has(roleDefaultSelectionKey(defaults))) {
        continue;
      }
      const profile = migratedRoleDefaultProfile({ roleId: summary.id, defaults });
      if (existingIds.has(profile.id)) {
        profile.id = `${profile.id}:migrated`;
      }
      existingIds.add(profile.id);
      existingSelections.add(agentProfileSelectionKey(profile));
      migratedProfiles.push(profile);
    }

    if (Object.keys(roleProfilesPatch).length === 0) {
      return;
    }
    await host.patchDaemonConfig({
      agentProfiles: [...existingProfiles, ...migratedProfiles],
      roleProfiles: roleProfilesPatch,
    });
  }
}

function completionKey(serverId: string): string {
  return `${COMPLETION_KEY_PREFIX}${serverId}`;
}

function favoriteKey(favorite: Pick<LegacyFavorite, "provider" | "modelId">): string {
  return `${favorite.provider}\u0000${favorite.modelId}`;
}

function migratedProfileId(favorite: LegacyFavorite): string {
  return `legacy_favorite:${encodeURIComponent(favorite.provider)}:${encodeURIComponent(favorite.modelId)}`;
}

function deduplicateFavorites(favorites: readonly LegacyFavorite[]): LegacyFavorite[] {
  const seen = new Set<string>();
  return favorites.filter((favorite) => {
    const key = favoriteKey(favorite);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function findCatalogLabels(
  favorite: LegacyFavorite,
  entries: readonly ProviderSnapshotEntry[],
): { model: string; provider: string } {
  const provider = entries.find((entry) => entry.provider === favorite.provider);
  const model = provider?.models?.find((entry) => entry.id === favorite.modelId);
  return {
    model: model?.label?.trim() || favorite.modelId,
    provider: provider?.label?.trim() || favorite.provider,
  };
}

function uniqueProfileName(input: {
  favorite: LegacyFavorite;
  entries: readonly ProviderSnapshotEntry[];
  usedNames: Set<string>;
}): string {
  const labels = findCatalogLabels(input.favorite, input.entries);
  const candidates = [
    labels.model,
    `${labels.provider} · ${labels.model}`,
    `${labels.provider} · ${labels.model} (${input.favorite.modelId})`,
  ];
  for (const candidate of candidates) {
    if (!input.usedNames.has(candidate)) {
      input.usedNames.add(candidate);
      return candidate;
    }
  }
  let suffix = 2;
  while (input.usedNames.has(`${candidates[2]} ${suffix}`)) {
    suffix += 1;
  }
  const name = `${candidates[2]} ${suffix}`;
  input.usedNames.add(name);
  return name;
}

function buildMigratedProfiles(input: {
  favorites: readonly LegacyFavorite[];
  existing: readonly AgentProfile[];
  entries: readonly ProviderSnapshotEntry[];
}): AgentProfile[] {
  const existingSelections = new Set(
    input.existing.map((profile) =>
      favoriteKey({ provider: profile.provider, modelId: profile.model?.trim() ?? "" }),
    ),
  );
  const existingIds = new Set(input.existing.map((profile) => profile.id));
  const usedNames = new Set(input.existing.map((profile) => profile.name));

  return deduplicateFavorites(input.favorites).flatMap((favorite) => {
    const id = migratedProfileId(favorite);
    if (existingSelections.has(favoriteKey(favorite)) || existingIds.has(id)) {
      return [];
    }
    return [
      {
        id,
        name: uniqueProfileName({ favorite, entries: input.entries, usedNames }),
        provider: favorite.provider,
        model: favorite.modelId,
      },
    ];
  });
}

function catalogIsLoading(
  entries: readonly ProviderSnapshotEntry[],
  favorites: readonly LegacyFavorite[],
): boolean {
  const providers = new Set(favorites.map((favorite) => favorite.provider));
  return entries.some((entry) => providers.has(entry.provider) && entry.status === "loading");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readProviderCatalog(
  host: LegacyFavoriteMigrationHost,
  favorites: readonly LegacyFavorite[],
): Promise<ProviderSnapshotEntry[]> {
  for (const retryDelay of CATALOG_LOADING_RETRY_DELAYS_MS) {
    const entries = (await host.getProvidersSnapshot()).entries;
    if (!catalogIsLoading(entries, favorites)) {
      return entries;
    }
    await delay(retryDelay);
  }
  const entries = (await host.getProvidersSnapshot()).entries;
  if (catalogIsLoading(entries, favorites)) {
    throw new Error("Provider catalog remained loading during legacy favourite migration");
  }
  return entries;
}

/**
 * One-time bridge from device-local model favourites to host-wide profiles.
 * The module owns every migration invariant; callers only announce a connected
 * host and may safely call again after reconnects or React remounts.
 */
export class LegacyFavoriteProfileMigration {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly storage: LegacyFavoriteMigrationStorage) {}

  migrateHost(serverId: string, host: LegacyFavoriteMigrationHost): Promise<void> {
    const active = this.inFlight.get(serverId);
    if (active) {
      return active;
    }
    const migration = this.run(serverId, host).finally(() => {
      if (this.inFlight.get(serverId) === migration) {
        this.inFlight.delete(serverId);
      }
    });
    this.inFlight.set(serverId, migration);
    return migration;
  }

  private async run(serverId: string, host: LegacyFavoriteMigrationHost): Promise<void> {
    if (!supportsMigration(host)) {
      return;
    }
    const markerKey = completionKey(serverId);
    if ((await readValidatedString(this.storage, markerKey, z.literal("1"))) === "1") {
      return;
    }

    const preferences = await readValidatedJson(
      this.storage,
      PREFERENCES_KEY,
      FormPreferencesSchema,
    );
    const favorites = preferences?.favoriteModels ?? [];
    if (favorites.length === 0) {
      await this.storage.setItem(markerKey, "1");
      return;
    }

    const [{ config }, entries] = await Promise.all([
      host.getDaemonConfig(),
      readProviderCatalog(host, favorites),
    ]);
    const existing = config.agentProfiles ?? [];
    const migrated = buildMigratedProfiles({ favorites, existing, entries });
    if (migrated.length > 0) {
      await host.patchDaemonConfig({ agentProfiles: [...existing, ...migrated] });
    }
    await this.storage.setItem(markerKey, "1");
  }
}

export const legacyFavoriteProfileMigration = new LegacyFavoriteProfileMigration(AsyncStorage);
export const roleDefaultProfileMigration = new RoleDefaultProfileMigration();
