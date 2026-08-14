import { useCallback, useMemo } from "react";
import type { RoleProfileCatalog } from "@getpaseo/protocol/role-profile";

import { useReplicaQuery } from "@/data/query";
import { roleProfilesQueryKey } from "@/data/role-profiles";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

interface UseRoleProfilesResult {
  catalog: RoleProfileCatalog | null;
  isLoading: boolean;
  error: string | null;
  supported: boolean;
  refetch: () => Promise<RoleProfileCatalog | null>;
}

export function useRoleProfiles(serverId: string | null): UseRoleProfilesResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useHostFeature(serverId, "roleProfiles");
  const queryKey = useMemo(() => roleProfilesQueryKey(serverId), [serverId]);
  const query = useReplicaQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected && supported),
    pushEvent: "status:daemon_config_changed",
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      const response = await client.getRoleProfiles();
      return response.catalog;
    },
  });

  const refetch = useCallback(async () => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    catalog: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    supported,
    refetch,
  };
}
