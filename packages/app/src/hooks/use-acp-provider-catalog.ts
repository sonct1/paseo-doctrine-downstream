import { useCallback, useState } from "react";
import type { MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
import { ACP_PROVIDER_CATALOG, type AcpProviderCatalogEntry } from "@/data/acp-provider-catalog";

export type AcpProviderCatalogItem = AcpProviderCatalogEntry;

const SUPPORTED_ACP_PROVIDER_IDS = new Set(["cursor"]);

export function getAcpProviderCatalog(): AcpProviderCatalogItem[] {
  return ACP_PROVIDER_CATALOG.filter((entry) => SUPPORTED_ACP_PROVIDER_IDS.has(entry.id));
}

export function buildAcpProviderConfigPatch(
  entry: AcpProviderCatalogItem,
): MutableDaemonConfigPatch {
  return {
    providers: {
      [entry.id]: {
        extends: "acp",
        label: entry.title,
        description: entry.description,
        command: [...entry.command],
        env: entry.env ? { ...entry.env } : {},
        ...(entry.params ? { params: { ...entry.params } } : {}),
      },
    },
  };
}

export function useAcpProviderCatalog() {
  const [entries] = useState<AcpProviderCatalogItem[]>(getAcpProviderCatalog);

  const refetch = useCallback(async () => entries, [entries]);

  return { entries, loading: false, error: null, refetch };
}
