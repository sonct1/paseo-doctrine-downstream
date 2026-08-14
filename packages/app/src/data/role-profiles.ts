export function roleProfilesQueryKey(serverId: string | null) {
  return ["role-profiles", serverId] as const;
}
