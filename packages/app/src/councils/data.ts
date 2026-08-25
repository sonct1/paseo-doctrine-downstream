import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";

export const councilQueryKeys = {
  list: (serverId: string) => ["councilCases", serverId] as const,
};

export function useCouncilCasesQuery(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsCouncilCases = useHostFeature(serverId, "councilCases");
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);

  const query = useFetchQuery({
    queryKey: [...councilQueryKeys.list(serverId), runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Host client unavailable");
      const response = await client.listCouncilCases();
      if (response.error) throw new Error(response.error);
      return response.cases;
    },
    enabled: Boolean(serverId && client && isConnected && supportsCouncilCases),
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  return { ...query, supportsCouncilCases, isConnected };
}
