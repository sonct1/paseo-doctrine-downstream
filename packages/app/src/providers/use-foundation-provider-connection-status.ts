import { useEffect, useState } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export type FoundationProviderConnectionQualification =
  | "loading"
  | "unqualified"
  | "qualified"
  | "stale";

export function useFoundationProviderConnectionStatus(input: {
  serverId: string;
  provider: string;
  model: string | null;
  enabled: boolean;
  refreshKey?: string;
}): FoundationProviderConnectionQualification {
  const client = useHostRuntimeClient(input.serverId);
  const [status, setStatus] = useState<FoundationProviderConnectionQualification>("loading");

  useEffect(() => {
    let active = true;
    if (!input.enabled || !input.model || !client) {
      setStatus("unqualified");
      return () => {
        active = false;
      };
    }
    setStatus("loading");
    void client
      .getFoundationProviderConnectionStatus(input.provider, input.model)
      .then((result) => {
        if (active) setStatus(result.status);
        return undefined;
      })
      .catch(() => {
        if (active) setStatus("unqualified");
      });
    return () => {
      active = false;
    };
  }, [client, input.enabled, input.model, input.provider, input.refreshKey]);

  return status;
}
