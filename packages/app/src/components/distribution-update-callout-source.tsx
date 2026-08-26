import { Gift } from "lucide-react-native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { SidebarCalloutDescriptionText } from "@/components/sidebar-callout";
import { claimColdOpenDistributionUpdateCheck } from "@/components/distribution-update-check-policy";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openExternalUrl } from "@/utils/open-external-url";

interface AvailableDistributionUpdate {
  serverId: string;
  hostLabel: string;
  version: string;
  tag: string;
  releaseUrl: string;
  phase: "available" | "installing" | "failed";
  message: string | null;
}

const ThemedGift = withUnistyles(Gift);
const giftIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function DistributionUpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (listener) => runtime.subscribeAll(listener),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const updateSupport = useSessionStore(
    useShallow((state) =>
      Object.fromEntries(
        hosts.map((host) => [
          host.serverId,
          state.sessions[host.serverId]?.serverInfo?.features?.distributionUpdate === true,
        ]),
      ),
    ),
  );
  const [updates, setUpdates] = useState<Record<string, AvailableDistributionUpdate>>({});

  useEffect(() => {
    void runtimeVersion;
    for (const host of hosts) {
      if (updateSupport[host.serverId] !== true) {
        continue;
      }
      const snapshot = runtime.getSnapshot(host.serverId);
      if (!snapshot?.client || !isHostRuntimeConnected(snapshot)) continue;
      if (!claimColdOpenDistributionUpdateCheck(host.serverId)) continue;

      // Cold-open is the trigger opportunity. Reconnects, focus, resume, and rerenders
      // cannot clear this process-local guard; the daemon owns the persistent 24h cache.
      void snapshot.client
        .checkDistributionUpdate({ intent: "automatic" })
        .then((result) => {
          const update = result.update;
          if (!update) return;
          setUpdates((current) => ({
            ...current,
            [host.serverId]: {
              serverId: host.serverId,
              hostLabel: host.label,
              version: update.version,
              tag: update.tag,
              releaseUrl: update.releaseUrl,
              phase: "available",
              message: null,
            },
          }));
          return undefined;
        })
        .catch(() => {
          // Automatic discovery is best-effort; manual CLI checks surface diagnostics.
        });
    }
  }, [hosts, runtime, runtimeVersion, updateSupport]);

  const selected = useMemo(
    () =>
      Object.values(updates).sort((left, right) =>
        left.hostLabel.localeCompare(right.hostLabel),
      )[0] ?? null,
    [updates],
  );

  const install = useStableEvent(() => {
    if (!selected || selected.phase === "installing") return;
    const client = runtime.getSnapshot(selected.serverId)?.client;
    if (!client) return;
    setUpdates((current) => ({
      ...current,
      [selected.serverId]: { ...selected, phase: "installing", message: null },
    }));
    const requestId = `distribution_update_${selected.serverId}_${selected.version}`;
    const unsubscribe = client.on("distribution.update.progress", (message) => {
      if (message.payload.requestId !== requestId) return;
      setUpdates((current) => {
        const existing = current[selected.serverId];
        if (!existing) return current;
        return {
          ...current,
          [selected.serverId]: {
            ...existing,
            phase: message.payload.status.phase === "failed" ? "failed" : "installing",
            message: message.payload.status.message,
          },
        };
      });
    });
    void client
      .applyDistributionUpdate({ tag: selected.tag, requestId })
      .then((result) => {
        unsubscribe();
        if (result.accepted) return undefined;
        setUpdates((current) => ({
          ...current,
          [selected.serverId]: {
            ...selected,
            phase: "failed",
            message: result.error ?? "Update was not accepted.",
          },
        }));
        return undefined;
      })
      .catch((error) => {
        unsubscribe();
        setUpdates((current) => ({
          ...current,
          [selected.serverId]: {
            ...selected,
            phase: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      });
  });

  const openRelease = useStableEvent(() => {
    if (selected) void openExternalUrl(selected.releaseUrl);
  });

  useEffect(() => {
    if (!selected) return;
    const installing = selected.phase === "installing";
    const failed = selected.phase === "failed";
    let title = t("desktop.updates.callout.availableTitle");
    if (installing) title = t("desktop.updates.callout.installingTitle");
    if (failed) title = t("desktop.updates.callout.failedTitle");
    return callouts.show({
      id: `distribution-update-${selected.serverId}`,
      dismissalKey: `distribution-update:${selected.serverId}:${selected.version}`,
      priority: 80,
      title,
      description: (
        <SidebarCalloutDescriptionText>
          {selected.message ??
            t("desktop.updates.callout.versionReady", {
              version: selected.version,
            })}
        </SidebarCalloutDescriptionText>
      ),
      icon: <ThemedGift size={ICON_SIZE.sm} uniProps={giftIconMapping} />,
      variant: failed ? "error" : "default",
      actions: [
        {
          label: t("desktop.updates.callout.whatsNew"),
          onPress: openRelease,
          variant: "secondary",
          disabled: installing,
        },
        {
          label: installing
            ? t("desktop.updates.callout.installingAction")
            : t("desktop.updates.callout.installAndRestart"),
          onPress: install,
          variant: "primary",
          disabled: installing,
        },
      ],
      testID: "distribution-update-callout",
    });
  }, [callouts, install, openRelease, selected, t]);

  return null;
}
