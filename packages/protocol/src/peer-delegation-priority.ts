import type { PeerSubrole } from "./messages.js";

export interface PeerDelegationProfileRoute {
  id: string;
  provider: string;
  peerSubrole?: PeerSubrole;
}

export function selectPeerDelegationProfiles<T extends PeerDelegationProfileRoute>(
  profiles: readonly T[],
  profileIds: readonly string[],
): T[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const seen = new Set<string>();
  return profileIds.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const profile = profilesById.get(id);
    return profile ? [profile] : [];
  });
}

export function resolvePeerDelegationProviderPriority(
  profiles: readonly PeerDelegationProfileRoute[],
  profileIds: readonly string[],
  configuredPriority: readonly string[] | undefined,
): string[] {
  const selectedProviders: string[] = [];
  const selectedProviderSet = new Set<string>();
  for (const profile of selectPeerDelegationProfiles(profiles, profileIds)) {
    const provider = profile.provider.trim();
    if (!provider || selectedProviderSet.has(provider)) continue;
    selectedProviderSet.add(provider);
    selectedProviders.push(provider);
  }

  const priority: string[] = [];
  const seen = new Set<string>();
  for (const provider of configuredPriority ?? []) {
    if (!selectedProviderSet.has(provider) || seen.has(provider)) continue;
    seen.add(provider);
    priority.push(provider);
  }
  for (const provider of selectedProviders) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    priority.push(provider);
  }
  return priority;
}

export function orderPeerDelegationProfiles<T extends PeerDelegationProfileRoute>(
  profiles: readonly T[],
  providerPriority: readonly string[],
): T[] {
  const providerRank = new Map(providerPriority.map((provider, index) => [provider, index]));
  return profiles
    .map((profile, index) => ({ profile, index }))
    .sort((left, right) => {
      const leftRank = providerRank.get(left.profile.provider) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = providerRank.get(right.profile.provider) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ profile }) => profile);
}

export function selectPeerDelegationProfileForSubrole<T extends PeerDelegationProfileRoute>(
  profiles: readonly T[],
  profileIds: readonly string[],
  configuredPriority: readonly string[] | undefined,
  subrole: PeerSubrole,
): T | undefined {
  const selectedProfiles = selectPeerDelegationProfiles(profiles, profileIds).filter(
    (profile) => profile.peerSubrole === subrole,
  );
  const providerPriority = resolvePeerDelegationProviderPriority(
    selectedProfiles,
    selectedProfiles.map((profile) => profile.id),
    configuredPriority,
  );
  return orderPeerDelegationProfiles(selectedProfiles, providerPriority)[0];
}
