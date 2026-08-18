import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig, PeerDelegationModelRoute } from "@getpaseo/protocol/messages";
import { isPaseoSupportedProvider } from "@getpaseo/protocol/provider-config";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { settingsStyles } from "@/styles/settings";

const RUN_MODE_OPTIONS = [
  { value: "guarded", label: "Guarded", testID: "peer-run-mode-guarded" },
  { value: "unattended", label: "Unattended", testID: "peer-run-mode-unattended" },
] as const;

function routeKey(route: PeerDelegationModelRoute): string {
  return `${route.provider}\u0000${route.model}`;
}

function normalizedRoutes(routes: readonly PeerDelegationModelRoute[]) {
  return [...routes].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model),
  );
}

function PeerModelPolicyRow({
  provider,
  model,
  label,
  selected,
  disabled,
  onChange,
}: {
  provider: PeerDelegationModelRoute["provider"];
  model: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onChange: (route: PeerDelegationModelRoute, selected: boolean) => void;
}) {
  const route = useMemo(() => ({ provider, model }), [model, provider]);
  const handleChange = useCallback((next: boolean) => onChange(route, next), [onChange, route]);
  return (
    <View style={styles.modelRow}>
      <View style={styles.modelCopy}>
        <Text style={styles.modelLabel}>{label || model}</Text>
        <Text style={styles.modelId}>
          {provider}/{model}
        </Text>
      </View>
      <Switch
        value={selected}
        onValueChange={handleChange}
        disabled={disabled}
        accessibilityLabel={`${selected ? "Disallow" : "Allow"} Peer model ${provider}/${model}`}
        testID={`peer-model-${provider}-${model}`}
      />
    </View>
  );
}

export function PeerDelegationModelsCard({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const policy = config?.peerDelegation ?? {
    enabled: false,
    allowedModels: [],
    runMode: "unattended" as const,
  };
  const selectedKeys = useMemo(
    () => new Set(policy.allowedModels.map(routeKey)),
    [policy.allowedModels],
  );
  const providerEntries = useMemo(
    () =>
      (snapshot.entries ?? [])
        .filter(
          (entry) =>
            entry.enabled !== false &&
            entry.status === "ready" &&
            isPaseoSupportedProvider(entry.provider, config?.providers?.[entry.provider]),
        )
        .map((entry) => ({
          provider: entry.provider,
          label: entry.label ?? entry.provider,
          models: filterSelectableModels(entry.models ?? []) ?? [],
        }))
        .filter((entry) => entry.models.length > 0),
    [config?.providers, snapshot.entries],
  );

  const savePolicy = useCallback(
    async (next: MutableDaemonConfig["peerDelegation"], key: string) => {
      setSavingKey(key);
      try {
        await patchConfig({ peerDelegation: next });
      } catch (error) {
        Alert.alert(
          "Could not save Peer model policy",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setSavingKey(null);
      }
    },
    [patchConfig],
  );

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      void savePolicy(
        { enabled, allowedModels: policy.allowedModels, runMode: policy.runMode },
        "enabled",
      );
    },
    [policy.allowedModels, policy.runMode, savePolicy],
  );

  const handleRouteChange = useCallback(
    (route: PeerDelegationModelRoute, selected: boolean) => {
      const next = selected
        ? normalizedRoutes([...policy.allowedModels, route])
        : policy.allowedModels.filter((candidate) => routeKey(candidate) !== routeKey(route));
      void savePolicy(
        { enabled: true, allowedModels: next, runMode: policy.runMode },
        routeKey(route),
      );
    },
    [policy.allowedModels, policy.runMode, savePolicy],
  );

  const handleRunModeChange = useCallback(
    (runMode: "guarded" | "unattended") => {
      void savePolicy(
        { enabled: policy.enabled, allowedModels: policy.allowedModels, runMode },
        "run-mode",
      );
    },
    [policy.allowedModels, policy.enabled, savePolicy],
  );

  return (
    <View style={[settingsStyles.card, styles.card]} testID="peer-delegation-models-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Allow Lead → Peer delegation</Text>
          <Text style={settingsStyles.rowHint}>
            Off blocks new Peers. On, the daemon permits only the exact provider/model routes
            selected below; an empty selection still blocks creation.
          </Text>
        </View>
        <Switch
          value={policy.enabled}
          onValueChange={handleEnabledChange}
          disabled={savingKey !== null}
          accessibilityLabel={`${policy.enabled ? "Disable" : "Enable"} Lead to Peer delegation`}
          testID="peer-delegation-policy-enabled"
        />
      </View>
      {policy.enabled ? (
        <>
          <View style={[settingsStyles.row, styles.runModeRow]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Peer runtime</Text>
              <Text style={settingsStyles.rowHint}>
                Guarded keeps provider approval boundaries. Unattended selects a qualified provider
                no-prompt mode and fails closed when none exists.
              </Text>
            </View>
            <SegmentedControl
              options={[...RUN_MODE_OPTIONS]}
              value={policy.runMode}
              onValueChange={handleRunModeChange}
              size="sm"
              testID="peer-run-mode"
            />
          </View>
          <View style={styles.providerList} testID="peer-delegation-model-list">
            {providerEntries.map((entry) => (
              <View key={entry.provider} style={styles.providerGroup}>
                <Text style={styles.providerLabel}>{entry.label}</Text>
                {entry.models.map((model) => {
                  const key = routeKey({ provider: entry.provider, model: model.id });
                  return (
                    <PeerModelPolicyRow
                      key={model.id}
                      provider={entry.provider}
                      model={model.id}
                      label={model.label}
                      selected={selectedKeys.has(key)}
                      disabled={savingKey !== null}
                      onChange={handleRouteChange}
                    />
                  );
                })}
              </View>
            ))}
            {providerEntries.length === 0 ? (
              <Text style={styles.empty}>No enabled provider models are currently available.</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { overflow: "hidden" },
  providerList: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  runModeRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  providerGroup: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  providerLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  modelRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  modelCopy: { flex: 1 },
  modelLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  modelId: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
}));
