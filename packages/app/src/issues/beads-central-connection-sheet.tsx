import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { type FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  normalizeBeadsCentralCredentialRef,
  normalizeBeadsCentralEndpoint,
  validateBeadsCentralToken,
} from "./beads-central-connection-model";

interface BeadsCentralConnectionSheetProps {
  serverId: string;
  endpoint: string;
  credentialRef: string;
  onClose: () => void;
  onSaved: () => void;
}

type SubmitState = "idle" | "saving" | "deleting";

function useCentralCredentialStatus(
  client: ReturnType<typeof useHostRuntimeClient>,
  credentialRef: string | null,
) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setConfigured(null);
    setStatusError(null);
    if (!client || !credentialRef) {
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const status = await client.getFoundationCredentialStatus(credentialRef);
        if (active) setConfigured(status.configured);
      } catch (cause) {
        if (!active) return;
        setConfigured(false);
        setStatusError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      active = false;
    };
  }, [client, credentialRef]);
  return { configured, setConfigured, statusError };
}

function credentialStatusHint(configured: boolean | null): string {
  if (configured === true) return "A private token is configured on this host.";
  if (configured === false) return "No token is configured for this reference.";
  return "Checking private host credential…";
}

function connectionControlSize(compact: boolean): FieldControlSize {
  return compact ? "md" : "sm";
}

export function BeadsCentralConnectionSheet({
  serverId,
  endpoint: initialEndpoint,
  credentialRef: initialCredentialRef,
  onClose,
  onSaved,
}: BeadsCentralConnectionSheetProps) {
  const controlSize = connectionControlSize(useIsCompactFormFactor());
  const client = useHostRuntimeClient(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [credentialRef, setCredentialRef] = useState(initialCredentialRef);
  const [token, setToken] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const normalizedEndpoint = normalizeBeadsCentralEndpoint(endpoint);
  const normalizedCredentialRef = normalizeBeadsCentralCredentialRef(credentialRef);
  const tokenValid = validateBeadsCentralToken(token);
  const {
    configured: credentialConfigured,
    setConfigured: setCredentialConfigured,
    statusError,
  } = useCentralCredentialStatus(client, normalizedCredentialRef);

  const header = useMemo<SheetHeader>(
    () => ({
      title: "Beads Central connection",
      subtitle: (
        <Text style={styles.headerSubtitle}>
          One project-scoped work graph for Human, Lead, Peer, and Supervisor
        </Text>
      ),
    }),
    [],
  );
  const hasCredential = credentialConfigured === true || token.trim().length >= 32;
  const hasChanges =
    normalizedEndpoint !== initialEndpoint ||
    normalizedCredentialRef !== initialCredentialRef ||
    token.trim().length > 0;
  const canSave = Boolean(
    client &&
    normalizedEndpoint &&
    normalizedCredentialRef &&
    tokenValid &&
    hasCredential &&
    hasChanges &&
    submitState === "idle",
  );

  const handleSave = useCallback(async () => {
    if (!client || !normalizedEndpoint || !normalizedCredentialRef || !canSave) return;
    setSubmitState("saving");
    setError(null);
    try {
      if (token.trim()) {
        await client.setFoundationCredential(normalizedCredentialRef, token.trim());
      }
      const updated = await patchConfig({
        beadsCentral: { endpoint: normalizedEndpoint, credentialRef: normalizedCredentialRef },
      });
      if (!updated) throw new Error("The host disconnected before Central configuration was saved");
      setCredentialConfigured(true);
      setToken("");
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitState("idle");
    }
  }, [
    canSave,
    client,
    normalizedCredentialRef,
    normalizedEndpoint,
    onClose,
    onSaved,
    patchConfig,
    setCredentialConfigured,
    token,
  ]);
  const handleSavePress = useCallback(() => void handleSave(), [handleSave]);

  const handleDelete = useCallback(async () => {
    if (!client || !normalizedCredentialRef || credentialConfigured !== true) return;
    const confirmed = await confirmDialog({
      title: "Delete Central token?",
      message:
        "Lead, Peer, Supervisor, and the Human Issues surface will fail closed until a token is saved again.",
      confirmLabel: "Delete token",
      destructive: true,
    });
    if (!confirmed) return;
    setSubmitState("deleting");
    setError(null);
    try {
      await client.deleteFoundationCredential(normalizedCredentialRef);
      setCredentialConfigured(false);
      setToken("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitState("idle");
    }
  }, [client, credentialConfigured, normalizedCredentialRef, onSaved, setCredentialConfigured]);
  const handleDeletePress = useCallback(() => void handleDelete(), [handleDelete]);

  const credentialHint = credentialStatusHint(credentialConfigured);

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={520}
      snapPoints={["62%"]}
      testID="beads-central-connection-sheet"
    >
      <View style={styles.form}>
        <Text style={styles.intro}>
          Paseo keeps the service token on this host and sends role agents only scoped `beads_*`
          tools. There is no native backend or fallback.
        </Text>
        <Field
          label="Central endpoint"
          hint="Use loopback for local Central, or HTTPS/private networking for a remote service."
          error={
            endpoint.trim() && !normalizedEndpoint
              ? "Enter an HTTP(S) URL without credentials, query, or fragment."
              : null
          }
          testID="beads-central-endpoint"
        >
          <FormTextInput
            size={controlSize}
            initialValue={initialEndpoint}
            resetKey={initialEndpoint}
            onChangeText={setEndpoint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://127.0.0.1:8080"
          />
        </Field>
        <Field
          label="Credential reference"
          hint={credentialHint}
          error={
            credentialRef.trim() && !normalizedCredentialRef
              ? "Use lowercase letters, digits, and hyphens; start with a letter."
              : null
          }
          testID="beads-central-credential-ref"
        >
          <FormTextInput
            size={controlSize}
            initialValue={initialCredentialRef}
            resetKey={initialCredentialRef}
            onChangeText={setCredentialRef}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="beads-central"
          />
        </Field>
        <Field
          label={credentialConfigured ? "Replace token (optional)" : "Central service token"}
          hint="Stored privately on this host; never returned to the app or exposed to role agents."
          error={
            !tokenValid
              ? "Central production tokens must be at least 32 characters."
              : (error ?? statusError)
          }
          testID="beads-central-token"
        >
          <FormTextInput
            size={controlSize}
            initialValue=""
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder={
              credentialConfigured ? "Leave blank to keep the current token" : "Paste token"
            }
          />
        </Field>
        <View style={styles.actions}>
          {credentialConfigured === true ? (
            <Button
              variant="destructive"
              size="sm"
              onPress={handleDeletePress}
              disabled={submitState !== "idle"}
              testID="beads-central-delete-token"
            >
              {submitState === "deleting" ? "Deleting…" : "Delete token"}
            </Button>
          ) : null}
          <View style={styles.actionSpacer} />
          <Button variant="secondary" size="sm" onPress={onClose} disabled={submitState !== "idle"}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleSavePress}
            disabled={!canSave}
            loading={submitState === "saving"}
            testID="beads-central-save"
          >
            Save and retry
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  form: {
    gap: theme.spacing[4],
  },
  intro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  actionSpacer: {
    flex: 1,
  },
}));
