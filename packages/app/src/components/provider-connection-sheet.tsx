import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { type FieldControlSize } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  openProviderConnectionForm,
  type ProviderConnectionFormModel,
} from "@/providers/provider-connection-form-model";
import { useProviderConnectionCredentialStatus } from "@/providers/use-provider-connection-credential-status";

interface ProviderConnectionSheetProps {
  mode: "create" | "edit";
  provider: string;
  providerLabel: string;
  serverId: string;
  baseUrl: string;
  onClose: () => void;
  onSaved: (providerId: string) => Promise<void>;
}

function useProviderConnectionForm(input: {
  mode: "create" | "edit";
  provider: string;
  providerLabel: string;
  baseUrl: string;
}): ProviderConnectionFormModel {
  const [model] = useState(() =>
    openProviderConnectionForm({
      mode: input.mode,
      providerId: input.provider,
      providerLabel: input.providerLabel,
      baseUrl: input.baseUrl,
    }),
  );
  useEffect(() => () => model.close(), [model]);
  return model;
}

export function ProviderConnectionSheet({
  mode,
  provider,
  providerLabel,
  serverId,
  baseUrl,
  onClose,
  onSaved,
}: ProviderConnectionSheetProps) {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const model = useProviderConnectionForm({ mode, provider, providerLabel, baseUrl });
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const client = useHostRuntimeClient(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  useProviderConnectionCredentialStatus({
    serverId,
    credentialRef: mode === "edit" ? provider : null,
    model,
  });

  const header = useMemo<SheetHeader>(
    () => ({
      title:
        mode === "create"
          ? t("settings.providers.connection.createTitle")
          : t("settings.providers.connection.title", { name: providerLabel }),
    }),
    [mode, providerLabel, t],
  );
  const handleSave = useCallback(async () => {
    if (!client || !state.canSave || !state.normalizedBaseUrl) return;
    model.startSaving();
    try {
      const targetProvider = state.providerId;
      if (state.apiKey.trim()) {
        await client.setFoundationCredential(targetProvider, state.apiKey);
      }
      const updated = await patchConfig({
        providers: {
          [targetProvider]: {
            ...(mode === "create"
              ? { extends: "codex", label: state.providerLabel.trim(), enabled: true }
              : {}),
            credentialRef: targetProvider,
            env: {
              OPENAI_BASE_URL: state.normalizedBaseUrl,
              PASEO_CLIPROXY_BASE_URL: state.normalizedBaseUrl,
            },
          },
        },
      });
      if (!updated) throw new Error(t("settings.providers.connection.hostDisconnected"));
      model.finishSaving();
      await onSaved(targetProvider);
      onClose();
    } catch (error) {
      model.failSaving(
        error instanceof Error ? error.message : t("settings.providers.connection.saveFailed"),
      );
    }
  }, [client, mode, model, onClose, onSaved, patchConfig, state, t]);
  const handleSavePress = useCallback(() => void handleSave(), [handleSave]);
  const credentialHint =
    state.credentialConfigured === true
      ? t("settings.providers.connection.credentialConfigured")
      : t("settings.providers.connection.credentialMissing");

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={480}
      snapPoints={["52%"]}
      testID="provider-connection-sheet"
    >
      <View style={styles.form}>
        {mode === "create" ? (
          <>
            <Field
              label={t("settings.providers.connection.providerId")}
              error={
                state.providerId && !/^[a-z][a-z0-9-]{0,63}$/u.test(state.providerId)
                  ? t("settings.providers.connection.invalidProviderId")
                  : null
              }
              testID="provider-connection-id"
            >
              <FormTextInput
                size={controlSize}
                value={state.providerId}
                onChangeText={model.setProviderId}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="codex-proxy"
              />
            </Field>
            <Field
              label={t("settings.providers.connection.providerLabel")}
              testID="provider-connection-label"
            >
              <FormTextInput
                size={controlSize}
                value={state.providerLabel}
                onChangeText={model.setProviderLabel}
                autoCorrect={false}
                placeholder="Codex proxy"
              />
            </Field>
          </>
        ) : null}
        <Field
          label={t("settings.providers.connection.baseUrl")}
          error={
            state.baseUrl.trim() && !state.normalizedBaseUrl
              ? t("settings.providers.connection.invalidBaseUrl")
              : null
          }
          testID="provider-connection-base-url"
        >
          <FormTextInput
            size={controlSize}
            value={state.baseUrl}
            onChangeText={model.setBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://provider.example/v1"
          />
        </Field>
        <Field
          label={t("settings.providers.connection.apiKey")}
          hint={credentialHint}
          error={state.error}
          testID="provider-connection-api-key"
        >
          <FormTextInput
            size={controlSize}
            value={state.apiKey}
            onChangeText={model.setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder={t("settings.providers.connection.apiKeyPlaceholder")}
          />
        </Field>
        <Text style={styles.note}>{t("settings.providers.connection.privateStorage")}</Text>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={onClose}
            disabled={state.status === "saving"}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button variant="default" size="sm" onPress={handleSavePress} disabled={!state.canSave}>
            {state.status === "saving"
              ? t("settings.providers.connection.saving")
              : t("settings.providers.connection.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[4],
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
