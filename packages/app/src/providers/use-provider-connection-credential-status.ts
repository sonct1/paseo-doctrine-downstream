import { useEffect } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { ProviderConnectionFormModel } from "./provider-connection-form-model";

export function useProviderConnectionCredentialStatus(input: {
  serverId: string;
  credentialRef: string | null;
  model: ProviderConnectionFormModel;
}): void {
  const client = useHostRuntimeClient(input.serverId);

  useEffect(() => {
    let active = true;
    if (!input.credentialRef) {
      input.model.applyCredentialStatus(false);
      return () => {
        active = false;
      };
    }
    if (!client) {
      input.model.applyCredentialStatus(false);
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const status = await client.getFoundationCredentialStatus(input.credentialRef!);
        if (active) input.model.applyCredentialStatus(status.configured);
      } catch (error: unknown) {
        if (!active) return;
        input.model.applyCredentialStatusError(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [client, input.credentialRef, input.model]);
}
