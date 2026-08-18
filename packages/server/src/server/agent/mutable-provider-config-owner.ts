import equal from "fast-deep-equal";

import type { DaemonConfigStore } from "../daemon-config-store.js";
import type {
  AgentManagerProviderState,
  ProviderSnapshotManager,
} from "./provider-snapshot-manager.js";

export function attachMutableProviderConfigOwner(options: {
  store: DaemonConfigStore;
  providerSnapshotManager: ProviderSnapshotManager;
  updateProviderRegistry: (state: AgentManagerProviderState) => void;
}): () => void {
  let publishPendingProviderChange: (() => void) | null = null;

  const unsubscribeApply = options.store.onApply((config, previous, details) => {
    if (equal(config.providers, previous.providers)) return () => undefined;

    const previousAgentManagerState =
      options.providerSnapshotManager.getAgentManagerProviderState();
    const staged = options.providerSnapshotManager.stageMutableProviderConfig(config.providers, {
      removeProviders: details.removedProviders,
      // The client-visible mutable config deliberately omits launch-only fields such as an
      // ACP command. Merge mutable values onto the startup overrides so toggling one provider
      // cannot make an unrelated custom provider invalid. Explicit removals still delete the
      // complete provider definition.
      replace: false,
    });
    try {
      options.updateProviderRegistry(staged.agentManagerState);
    } catch (error) {
      staged.rollback();
      throw error;
    }
    publishPendingProviderChange = staged.publish;

    return () => {
      publishPendingProviderChange = null;
      staged.rollback();
      options.updateProviderRegistry(previousAgentManagerState);
    };
  });
  const unsubscribeChange = options.store.onChange(() => {
    const publish = publishPendingProviderChange;
    publishPendingProviderChange = null;
    publish?.();
  });

  return () => {
    unsubscribeApply();
    unsubscribeChange();
  };
}
