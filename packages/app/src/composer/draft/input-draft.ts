import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import { useRoleProfiles } from "@/hooks/use-role-profiles";
import {
  buildDraftAgentControls,
  hasDraftContent,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandConfig,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useDraftStore } from "@/stores/draft-store";
import { toDraftInputIfReady } from "@/stores/draft-store/state";
import {
  isProviderRoleBindingSupportedForRole,
  PASEO_ROLE_SUMMARIES,
  type PaseoRoleId,
} from "@getpaseo/protocol/role-binding";
import {
  isAssignmentEffectAllowedForRole,
  PASEO_ASSIGNMENT_EFFECT_SUMMARIES,
  type AssignmentEffectClass,
} from "@getpaseo/protocol/assignment-contract";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";

const ASSIGNMENT_EFFECT_FEATURE_ID = "foundation_assignment_effect";
const BEADS_ISSUE_GRANT_FEATURE_ID = "foundation_beads_issue_grant";

export interface BeadsIssueGrantOption {
  id: string;
  label: string;
}

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialFeatureValues?: Record<string, unknown>;
  isVisible?: boolean;
  onlineServerIds?: string[];
  lockedWorkingDir?: string;
  beadsIssueOptions?: readonly BeadsIssueGrantOption[];
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  agentControls: DraftAgentControlsProps;
  commandDraftConfig: DraftCommandConfig | undefined;
  selectedRole: PaseoRoleId | null;
  setRoleFromUser: (roleId: PaseoRoleId) => void;
  selectedAssignmentEffect: AssignmentEffectClass;
  selectedBeadsIssueIds: string[];
};

export interface AgentInputDraft {
  text: string;
  editText: (text: string) => void;
  replaceText: (text: string) => void;
  textReplacementKey: string;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
}

function useBeadsIssueGrantControl(
  selectedRole: PaseoRoleId | null,
  issueOptions: readonly BeadsIssueGrantOption[] | undefined,
) {
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const feature = useMemo<AgentFeature | null>(
    () =>
      selectedRole === "peer"
        ? {
            type: "select",
            id: BEADS_ISSUE_GRANT_FEATURE_ID,
            label: "Peer issue grant",
            description: "Exact durable Beads issue leased to this Peer assignment.",
            value: selectedIssueId,
            options: [...(issueOptions ?? [])],
          }
        : null,
    [issueOptions, selectedIssueId, selectedRole],
  );

  useEffect(() => {
    if (selectedRole !== "peer") {
      setSelectedIssueId(null);
      return;
    }
    if (selectedIssueId && !issueOptions?.some((option) => option.id === selectedIssueId)) {
      setSelectedIssueId(null);
    }
  }, [issueOptions, selectedIssueId, selectedRole]);

  const setFromFeatureValue = useCallback(
    (value: unknown) => {
      const issueId = typeof value === "string" ? value.trim() : "";
      setSelectedIssueId(issueOptions?.some((option) => option.id === issueId) ? issueId : null);
    },
    [issueOptions],
  );

  return {
    feature,
    selectedIssueIds: selectedIssueId ? [selectedIssueId] : [],
    setFromFeatureValue,
  };
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const formState = useAgentFormState({
    initialServerId: composerOptions?.initialServerId ?? null,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
    onlineServerIds: composerOptions?.onlineServerIds ?? [],
  });
  const roleProfiles = useRoleProfiles(formState.selectedServerId);
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const draftRecord = useDraftStore((state) => state.drafts[draftKey]);
  const draft = useMemo(() => toDraftInputIfReady(draftRecord), [draftRecord]);
  const attachmentFocusRequestId = useDraftStore(
    (state) => state.attachmentFocusRequestByDraftKey[draftKey] ?? 0,
  );
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<PaseoRoleId | null>(null);
  const [selectedAssignmentEffect, setSelectedAssignmentEffect] =
    useState<AssignmentEffectClass>("read-only");
  const beadsIssueGrant = useBeadsIssueGrantControl(
    selectedRole,
    composerOptions?.beadsIssueOptions,
  );
  const [textReplacementRevision, setTextReplacementRevision] = useState(0);
  const text = draft?.text ?? "";
  const attachments = draft?.attachments ?? [];
  const isHydrated = hydratedDraftKey === draftKey;

  const saveDraft = useCallback(
    (
      update: (draft: { text: string; attachments: UserComposerAttachment[] }) => {
        text: string;
        attachments: UserComposerAttachment[];
      },
    ) => {
      const store = useDraftStore.getState();
      const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
      const next = update(current);
      if (!hasDraftContent(next)) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
        return;
      }
      store.saveDraftInput({ draftKey, draft: next });
    },
    [draftKey],
  );

  const editText = useCallback(
    (nextText: string) => {
      saveDraft((current) => ({ ...current, text: nextText }));
    },
    [saveDraft],
  );

  const replaceText = useCallback(
    (nextText: string) => {
      saveDraft((current) => ({ ...current, text: nextText }));
      setTextReplacementRevision((revision) => revision + 1);
    },
    [saveDraft],
  );

  const setAttachments = useCallback(
    (updater: AttachmentUpdater) => {
      saveDraft((current) => ({
        ...current,
        attachments: typeof updater === "function" ? updater(current.attachments) : updater,
      }));
    },
    [saveDraft],
  );

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      useDraftStore.getState().clearDraftInput({ draftKey, lifecycle });
    },
    [draftKey],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useDraftStore.getState().hydrateDraftInput({ draftKey });
      if (!cancelled) {
        setTextReplacementRevision((revision) => revision + 1);
        setHydratedDraftKey(draftKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  const lockedWorkingDir = composerOptions?.lockedWorkingDir?.trim() ?? "";
  useEffect(() => {
    if (!composerOptions || !lockedWorkingDir) {
      return;
    }
    if (formState.workingDir.trim() === lockedWorkingDir) {
      return;
    }
    formState.setWorkingDir(lockedWorkingDir);
  }, [composerOptions, formState, lockedWorkingDir]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const workingDir = lockedWorkingDir || formState.workingDir;
  const allProviderEntries = formState.allProviderEntries;
  const selectedProvider = formState.selectedProvider;
  const setProviderAndModelFromUser = formState.setProviderAndModelFromUser;
  useEffect(() => {
    if (!selectedRole) {
      return;
    }
    const entries = allProviderEntries ?? [];
    if (!entries.some((entry) => entry.roleBinding !== undefined)) {
      return;
    }
    const selectedEntry = entries.find((entry) => entry.provider === selectedProvider);
    if (isProviderRoleBindingSupportedForRole(selectedEntry?.roleBinding, selectedRole)) {
      return;
    }
    const compatible = entries.find(
      (entry) =>
        entry.enabled !== false &&
        entry.status === "ready" &&
        isProviderRoleBindingSupportedForRole(entry.roleBinding, selectedRole),
    );
    if (compatible) {
      setProviderAndModelFromUser(compatible.provider, "");
    }
  }, [allProviderEntries, selectedProvider, selectedRole, setProviderAndModelFromUser]);

  const {
    features: draftFeatures,
    featureValues: draftFeatureValues,
    setFeatureValue: setDraftFeatureValue,
    applyProfileFeatureValues,
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues,
  });
  const assignmentEffectFeature = useMemo<AgentFeature | null>(
    () =>
      selectedRole
        ? {
            type: "select",
            id: ASSIGNMENT_EFFECT_FEATURE_ID,
            label: "Assignment authority",
            description:
              "Explicit mutation/delegation class for the immutable assignment contract.",
            value: selectedAssignmentEffect,
            options: PASEO_ASSIGNMENT_EFFECT_SUMMARIES.filter((option) =>
              isAssignmentEffectAllowedForRole(selectedRole, option.id),
            ),
          }
        : null,
    [selectedAssignmentEffect, selectedRole],
  );
  const applyRoleProfileForSelection = useCallback(
    (roleId: PaseoRoleId) => {
      const profile = roleProfiles.catalog?.profiles.find((entry) => entry.roleId === roleId);
      if (!profile) return;
      const provider = profile.preferences.defaults?.provider;
      if (!provider) return;
      const providerEntry = allProviderEntries?.find((entry) => entry.provider === provider);
      if (
        providerEntry?.enabled === false ||
        providerEntry?.status !== "ready" ||
        !isProviderRoleBindingSupportedForRole(providerEntry.roleBinding, roleId)
      ) {
        return;
      }
      formState.applyRoleProfileDefaults(profile.preferences.defaults ?? {});
    },
    [allProviderEntries, formState, roleProfiles.catalog],
  );
  const setRoleAndNormalizeEffect = useCallback(
    (roleId: PaseoRoleId) => {
      setSelectedRole(roleId);
      applyRoleProfileForSelection(roleId);
      if (!isAssignmentEffectAllowedForRole(roleId, selectedAssignmentEffect)) {
        setSelectedAssignmentEffect("read-only");
      }
    },
    [applyRoleProfileForSelection, selectedAssignmentEffect],
  );
  const setAgentControlFeature = useCallback(
    (featureId: string, value: unknown) => {
      if (featureId === ASSIGNMENT_EFFECT_FEATURE_ID) {
        const selected = PASEO_ASSIGNMENT_EFFECT_SUMMARIES.find((option) => option.id === value);
        if (
          selectedRole &&
          selected &&
          isAssignmentEffectAllowedForRole(selectedRole, selected.id)
        ) {
          setSelectedAssignmentEffect(selected.id);
        }
        return;
      }
      if (featureId === BEADS_ISSUE_GRANT_FEATURE_ID) {
        beadsIssueGrant.setFromFeatureValue(value);
        return;
      }
      setDraftFeatureValue(featureId, value);
    },
    [beadsIssueGrant, selectedRole, setDraftFeatureValue],
  );

  const applyDraftAgentProfile = useCallback(
    (profile: Parameters<typeof formState.applyProfileFromUser>[0]) => {
      formState.applyProfileFromUser(profile);
      applyProfileFeatureValues(profile.featureValues);
    },
    [applyProfileFeatureValues, formState],
  );

  const commandDraftConfig = useMemo(
    () =>
      composerOptions
        ? buildDraftCommandConfig({
            selection: providerSelection,
            cwd: workingDir,
            effectiveModelId,
            effectiveThinkingOptionId,
            featureValues: draftFeatureValues,
          })
        : undefined,
    [
      composerOptions,
      effectiveModelId,
      effectiveThinkingOptionId,
      draftFeatureValues,
      providerSelection,
      workingDir,
    ],
  );

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    const roleBindingAvailable = formState.allProviderEntries?.some(
      (entry) => entry.roleBinding !== undefined,
    );
    const roleSelectionAvailable =
      roleBindingAvailable && (!roleProfiles.supported || roleProfiles.catalog !== null);
    const compatibleProviderIds = new Set(
      (formState.allProviderEntries ?? [])
        .filter((entry) => isProviderRoleBindingSupportedForRole(entry.roleBinding, selectedRole))
        .map((entry) => entry.provider),
    );
    const roleAwareFormState =
      roleSelectionAvailable && selectedRole
        ? {
            ...formState,
            providerDefinitions: formState.providerDefinitions.filter((definition) =>
              compatibleProviderIds.has(definition.id),
            ),
            modelSelectorProviders: formState.modelSelectorProviders.filter((provider) =>
              compatibleProviderIds.has(provider.id),
            ),
          }
        : formState;

    return {
      ...roleAwareFormState,
      workingDir,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues: draftFeatureValues,
      agentControls: buildDraftAgentControls({
        formState: roleAwareFormState,
        roleOptions: roleSelectionAvailable ? PASEO_ROLE_SUMMARIES : [],
        selectedRole: roleSelectionAvailable ? selectedRole : null,
        onSelectRole: setRoleAndNormalizeEffect,
        features:
          roleSelectionAvailable && (assignmentEffectFeature || beadsIssueGrant.feature)
            ? [
                ...(draftFeatures ?? []),
                ...(assignmentEffectFeature ? [assignmentEffectFeature] : []),
                ...(beadsIssueGrant.feature ? [beadsIssueGrant.feature] : []),
              ]
            : draftFeatures,
        onSetFeature: setAgentControlFeature,
        onApplyAgentProfile: applyDraftAgentProfile,
      }),
      commandDraftConfig,
      selectedRole: roleSelectionAvailable ? selectedRole : null,
      setRoleFromUser: setRoleAndNormalizeEffect,
      selectedAssignmentEffect,
      selectedBeadsIssueIds: beadsIssueGrant.selectedIssueIds,
    };
  }, [
    commandDraftConfig,
    composerOptions,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftFeatures,
    assignmentEffectFeature,
    beadsIssueGrant,
    draftFeatureValues,
    applyDraftAgentProfile,
    formState,
    roleProfiles.catalog,
    roleProfiles.supported,
    selectedRole,
    selectedAssignmentEffect,
    setAgentControlFeature,
    setRoleAndNormalizeEffect,
    workingDir,
  ]);

  return {
    text,
    editText,
    replaceText,
    textReplacementKey: `${draftKey}:${textReplacementRevision}`,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandConfig,
  buildDraftComposerCommandConfig: buildDraftCommandConfig,
  buildDraftAgentControls,
};
