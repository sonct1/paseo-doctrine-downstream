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
  resolveProviderCredentialRef,
  type ProviderConnectionFormModel,
} from "@/providers/provider-connection-form-model";
import { useProviderConnectionCredentialStatus } from "@/providers/use-provider-connection-credential-status";
import { confirmDialog } from "@/utils/confirm-dialog";

interface ProviderConnectionSheetProps {
  mode: "create" | "edit";
  provider: string;
  providerLabel: string;
  modelId: string;
  serverId: string;
  baseUrl: string;
  credentialRef: string | null;
  canTestConnection: boolean;
  onClose: () => void;
  onSaved: (providerId: string) => Promise<void>;
}

function useProviderConnectionForm(input: {
  mode: "create" | "edit";
  provider: string;
  providerLabel: string;
  modelId: string;
  baseUrl: string;
}): ProviderConnectionFormModel {
  const [model] = useState(() =>
    openProviderConnectionForm({
      mode: input.mode,
      providerId: input.provider,
      providerLabel: input.providerLabel,
      modelId: input.modelId,
      baseUrl: input.baseUrl,
    }),
  );
  useEffect(() => () => model.close(), [model]);
  return model;
}

function useProviderConnectionTest(input: {
  serverId: string;
  mode: "create" | "edit";
  provider: string;
  modelId: string;
  credentialConfigured: boolean | null;
  hasUnsavedChanges: boolean;
  onSaved: (providerId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(input.serverId);
  const [result, setResult] = useState<{
    status: "idle" | "testing" | "qualified" | "error";
    message: string | null;
  }>({ status: "idle", message: null });
  const canRun =
    input.mode === "edit" &&
    input.modelId.length > 0 &&
    input.credentialConfigured === true &&
    !input.hasUnsavedChanges;
  const run = useCallback(async () => {
    if (!client || !canRun) return;
    setResult({ status: "testing", message: null });
    try {
      const qualification = await client.testFoundationProviderConnection(
        input.provider,
        input.modelId,
      );
      setResult({
        status: "qualified",
        message: t("settings.providers.connection.testQualified", {
          model: qualification.model,
          latency: qualification.latencyMs ?? 0,
        }),
      });
      await input.onSaved(input.provider);
    } catch (error) {
      setResult({
        status: "error",
        message:
          error instanceof Error ? error.message : t("settings.providers.connection.testFailed"),
      });
    }
  }, [canRun, client, input, t]);
  const onPress = useCallback(() => void run(), [run]);
  return { ...result, canRun, onPress };
}

function ProviderConnectionTestResult({
  status,
  message,
}: {
  status: "idle" | "testing" | "qualified" | "error";
  message: string | null;
}) {
  if (!message) return null;
  return (
    <Text
      style={status === "error" ? styles.testError : styles.testSuccess}
      testID="provider-connection-test-result"
    >
      {message}
    </Text>
  );
}

function ProviderConnectionTestButton({
  visible,
  status,
  canRun,
  onPress,
}: {
  visible: boolean;
  status: "idle" | "testing" | "qualified" | "error";
  canRun: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onPress={onPress}
      disabled={status === "testing" || !canRun}
      testID="provider-connection-test"
    >
      {status === "testing"
        ? t("settings.providers.connection.testing")
        : t("settings.providers.connection.test")}
    </Button>
  );
}

function shouldShowConnectionTest(mode: "create" | "edit", featureAvailable: boolean): boolean {
  return mode === "edit" && featureAvailable;
}

export function ProviderConnectionSheet({
  mode,
  provider,
  providerLabel,
  modelId,
  serverId,
  baseUrl,
  credentialRef,
  canTestConnection,
  onClose,
  onSaved,
}: ProviderConnectionSheetProps) {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const model = useProviderConnectionForm({ mode, provider, providerLabel, baseUrl, modelId });
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const client = useHostRuntimeClient(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  useProviderConnectionCredentialStatus({
    serverId,
    credentialRef: mode === "edit" ? credentialRef : null,
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
      const targetCredentialRef = resolveProviderCredentialRef({
        mode,
        providerId: targetProvider,
        configuredCredentialRef: credentialRef,
      });
      if (state.apiKey.trim()) {
        await client.setFoundationCredential(targetCredentialRef, state.apiKey);
      }
      const updated = await patchConfig({
        providers: {
          [targetProvider]: {
            ...(mode === "create"
              ? {
                  extends: "codex",
                  label: state.providerLabel.trim(),
                  enabled: true,
                  additionalModels: [
                    {
                      id: state.modelId.trim(),
                      label: state.modelId.trim(),
                      isDefault: true,
                    },
                  ],
                }
              : {}),
            credentialRef: targetCredentialRef,
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
  }, [client, credentialRef, mode, model, onClose, onSaved, patchConfig, state, t]);
  const handleSavePress = useCallback(() => void handleSave(), [handleSave]);
  const hasUnsavedConnectionChanges =
    state.baseUrl !== baseUrl || state.apiKey.trim().length > 0 || state.status !== "idle";
  const connectionTest = useProviderConnectionTest({
    serverId,
    mode,
    provider,
    modelId,
    credentialConfigured: state.credentialConfigured,
    hasUnsavedChanges: hasUnsavedConnectionChanges,
    onSaved,
  });
  const handleDeleteCredential = useCallback(async () => {
    if (!client || mode !== "edit" || !credentialRef || state.credentialConfigured !== true) return;
    const confirmed = await confirmDialog({
      title: t("settings.providers.connection.deleteCredentialConfirmTitle"),
      message: t("settings.providers.connection.deleteCredentialConfirmMessage", {
        credentialRef,
      }),
      confirmLabel: t("settings.providers.connection.deleteCredentialConfirm"),
      destructive: true,
    });
    if (!confirmed) return;
    model.startDeleting();
    try {
      await client.deleteFoundationCredential(credentialRef);
      model.finishDeleting();
    } catch (error) {
      model.failDeleting(
        error instanceof Error
          ? error.message
          : t("settings.providers.connection.deleteCredentialFailed"),
      );
    }
  }, [client, credentialRef, mode, model, state.credentialConfigured, t]);
  const handleDeleteCredentialPress = useCallback(
    () => void handleDeleteCredential(),
    [handleDeleteCredential],
  );
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
                initialValue={state.providerId}
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
                initialValue={state.providerLabel}
                onChangeText={model.setProviderLabel}
                autoCorrect={false}
                placeholder="Codex proxy"
              />
            </Field>
            <Field
              label={t("settings.providers.models.modelId")}
              testID="provider-connection-model-id"
            >
              <FormTextInput
                size={controlSize}
                initialValue={state.modelId}
                onChangeText={model.setModelId}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("settings.providers.models.modelIdPlaceholder")}
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
            initialValue={state.baseUrl}
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
            initialValue={state.apiKey}
            onChangeText={model.setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder={t("settings.providers.connection.apiKeyPlaceholder")}
          />
        </Field>
        <Text style={styles.note}>{t("settings.providers.connection.privateStorage")}</Text>
        <ProviderConnectionTestResult
          status={connectionTest.status}
          message={connectionTest.message}
        />
        <View style={styles.actions}>
          <ProviderConnectionTestButton
            visible={shouldShowConnectionTest(mode, canTestConnection)}
            status={connectionTest.status}
            canRun={connectionTest.canRun}
            onPress={connectionTest.onPress}
          />
          <Button
            variant="secondary"
            size="sm"
            onPress={onClose}
            disabled={state.status !== "idle"}
          >
            {t("common.actions.cancel")}
          </Button>
          {mode === "edit" && credentialRef && state.credentialConfigured === true ? (
            <Button
              variant="destructive"
              size="sm"
              onPress={handleDeleteCredentialPress}
              disabled={state.status !== "idle"}
              testID="provider-connection-delete-credential"
            >
              {state.status === "deleting"
                ? t("settings.providers.connection.deletingCredential")
                : t("settings.providers.connection.deleteCredential")}
            </Button>
          ) : null}
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
  testSuccess: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.xs,
  },
  testError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
