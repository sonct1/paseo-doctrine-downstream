const coldOpenClaimedHosts = new Set<string>();

export function claimColdOpenDistributionUpdateCheck(serverId: string): boolean {
  if (coldOpenClaimedHosts.has(serverId)) return false;
  coldOpenClaimedHosts.add(serverId);
  return true;
}
