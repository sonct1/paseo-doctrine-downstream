export type ProviderConnectionStatus = "loading" | "idle" | "saving" | "deleting";

export interface ProviderConnectionFormState {
  mode: "create" | "edit";
  providerId: string;
  providerLabel: string;
  baseUrl: string;
  apiKey: string;
  credentialConfigured: boolean | null;
  status: ProviderConnectionStatus;
  error: string | null;
  normalizedBaseUrl: string | null;
  canSave: boolean;
}

export interface ProviderConnectionFormModel {
  getState: () => ProviderConnectionFormState;
  subscribe: (listener: () => void) => () => void;
  setProviderId: (value: string) => void;
  setProviderLabel: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setApiKey: (value: string) => void;
  applyCredentialStatus: (configured: boolean) => void;
  applyCredentialStatusError: (message: string) => void;
  startSaving: () => void;
  finishSaving: () => void;
  failSaving: (message: string) => void;
  startDeleting: () => void;
  finishDeleting: () => void;
  failDeleting: (message: string) => void;
  close: () => void;
}

export function normalizeProviderBaseUrl(rawValue: string): string | null {
  try {
    const parsed = new URL(rawValue.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const withoutTrailingSlashes = parsed.toString().replace(/\/+$/u, "");
    return withoutTrailingSlashes.endsWith("/v1")
      ? withoutTrailingSlashes
      : `${withoutTrailingSlashes}/v1`;
  } catch {
    return null;
  }
}

export function resolveProviderCredentialRef(input: {
  mode: "create" | "edit";
  providerId: string;
  configuredCredentialRef: string | null;
}): string {
  return input.mode === "edit" && input.configuredCredentialRef
    ? input.configuredCredentialRef
    : input.providerId;
}

function deriveState(
  current: Omit<ProviderConnectionFormState, "normalizedBaseUrl" | "canSave">,
): ProviderConnectionFormState {
  const normalizedBaseUrl = normalizeProviderBaseUrl(current.baseUrl);
  const hasCredential = current.credentialConfigured === true || current.apiKey.trim().length > 0;
  const hasValidIdentity =
    /^[a-z][a-z0-9-]{0,63}$/u.test(current.providerId) && current.providerLabel.trim().length > 0;
  return {
    ...current,
    normalizedBaseUrl,
    canSave:
      current.status === "idle" && normalizedBaseUrl !== null && hasCredential && hasValidIdentity,
  };
}

export function openProviderConnectionForm(input: {
  mode: "create" | "edit";
  providerId: string;
  providerLabel: string;
  baseUrl: string;
}): ProviderConnectionFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state = deriveState({
    mode: input.mode,
    providerId: input.providerId,
    providerLabel: input.providerLabel,
    baseUrl: input.baseUrl,
    apiKey: "",
    credentialConfigured: null,
    status: "loading",
    error: null,
  });

  const publish = (
    patch: Partial<Omit<ProviderConnectionFormState, "normalizedBaseUrl" | "canSave">>,
  ): void => {
    if (closed) return;
    state = deriveState({ ...state, ...patch });
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setProviderId: (providerId) => publish({ providerId, error: null }),
    setProviderLabel: (providerLabel) => publish({ providerLabel, error: null }),
    setBaseUrl: (baseUrl) => publish({ baseUrl, error: null }),
    setApiKey: (apiKey) => publish({ apiKey, error: null }),
    applyCredentialStatus: (credentialConfigured) =>
      publish({ credentialConfigured, status: "idle", error: null }),
    applyCredentialStatusError: (error) => publish({ status: "idle", error }),
    startSaving: () => publish({ status: "saving", error: null }),
    finishSaving: () =>
      publish({ status: "idle", credentialConfigured: true, apiKey: "", error: null }),
    failSaving: (error) => publish({ status: "idle", error }),
    startDeleting: () => publish({ status: "deleting", error: null }),
    finishDeleting: () =>
      publish({ status: "idle", credentialConfigured: false, apiKey: "", error: null }),
    failDeleting: (error) => publish({ status: "idle", error }),
    close: () => {
      closed = true;
      state = deriveState({
        ...state,
        apiKey: "",
        status: "idle",
        error: null,
      });
      listeners.clear();
    },
  };
}
