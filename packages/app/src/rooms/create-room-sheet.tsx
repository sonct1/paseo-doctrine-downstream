import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ChatRoomDetail } from "@getpaseo/protocol/chat/types";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { useWorkspace, useWorkspaceKeys } from "@/stores/session-store-hooks";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";
import { toErrorMessage } from "@/utils/error-messages";

interface CreateRoomSheetProps {
  client: DaemonClient | null;
  serverId: string;
  visible: boolean;
  onClose: () => void;
  onCreated: (room: ChatRoomDetail) => void;
}

interface CreateRoomDraft {
  name: string;
  purpose: string;
  workspaceId: string | null;
}

type CreateRoomDraftAction =
  | { type: "name"; value: string }
  | { type: "purpose"; value: string }
  | { type: "workspaceId"; value: string }
  | { type: "reset" };

const EMPTY_DRAFT: CreateRoomDraft = { name: "", purpose: "", workspaceId: null };
const CREATE_ROOM_HEADER = { title: "Create room" };
const CREATE_ROOM_SNAP_POINTS = ["55%", "80%"];

function reduceCreateRoomDraft(
  state: CreateRoomDraft,
  action: CreateRoomDraftAction,
): CreateRoomDraft {
  if (action.type === "name") {
    return { ...state, name: action.value };
  }
  if (action.type === "purpose") {
    return { ...state, purpose: action.value };
  }
  if (action.type === "workspaceId") {
    return { ...state, workspaceId: action.value };
  }
  return EMPTY_DRAFT;
}

export function CreateRoomSheet({
  client,
  serverId,
  visible,
  onClose,
  onCreated,
}: CreateRoomSheetProps) {
  const [draft, dispatch] = useReducer(reduceCreateRoomDraft, EMPTY_DRAFT);
  const [inputRevision, bumpInputRevision] = useReducer((revision: number) => revision + 1, 0);
  const allWorkspaceKeys = useWorkspaceKeys(serverId);
  const [unavailableWorkspaceIds, setUnavailableWorkspaceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleWorkspaceAvailabilityChange = useCallback(
    (workspaceId: string, available: boolean) => {
      setUnavailableWorkspaceIds((current) => {
        const isMarkedUnavailable = current.has(workspaceId);
        if (available === isMarkedUnavailable) {
          const next = new Set(current);
          if (available) {
            next.delete(workspaceId);
          } else {
            next.add(workspaceId);
          }
          return next;
        }
        return current;
      });
    },
    [],
  );
  const workspaceKeys = useMemo(
    () => allWorkspaceKeys.filter((workspaceId) => !unavailableWorkspaceIds.has(workspaceId)),
    [allWorkspaceKeys, unavailableWorkspaceIds],
  );
  const supportsWorkspaceScoping = useHostFeature(serverId, "chatRoomWorkspaceScoping");
  useEffect(() => {
    if (draft.workspaceId && unavailableWorkspaceIds.has(draft.workspaceId)) {
      dispatch({ type: "workspaceId", value: "" });
    }
  }, [draft.workspaceId, unavailableWorkspaceIds]);
  const createMutation = useMutation({
    mutationFn: async (): Promise<ChatRoomDetail> => {
      if (!client) {
        throw new Error("Host client unavailable");
      }
      if (!supportsWorkspaceScoping) {
        throw new Error("Update this Paseo host to place rooms in a workspace");
      }
      if (!draft.workspaceId) {
        throw new Error("Select a workspace to place this room");
      }
      const response = await client.createChatRoom({
        name: draft.name.trim(),
        purpose: draft.purpose.trim() || undefined,
        workspaceId: draft.workspaceId,
      });
      if (response.error || !response.room) {
        throw new Error(response.error ?? "Unable to create room");
      }
      return response.room;
    },
    onSuccess: (room) => {
      dispatch({ type: "reset" });
      bumpInputRevision();
      onCreated(room);
    },
  });

  const handleClose = useCallback(() => {
    if (createMutation.isPending) {
      return;
    }
    createMutation.reset();
    dispatch({ type: "reset" });
    bumpInputRevision();
    onClose();
  }, [createMutation, onClose]);
  const handleCreate = useCallback(() => {
    createMutation.reset();
    createMutation.mutate();
  }, [createMutation]);
  const handleNameChange = useCallback((value: string) => dispatch({ type: "name", value }), []);
  const handlePurposeChange = useCallback(
    (value: string) => dispatch({ type: "purpose", value }),
    [],
  );
  const handleWorkspaceSelect = useCallback(
    (value: string) => dispatch({ type: "workspaceId", value }),
    [],
  );

  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleClose}
          disabled={createMutation.isPending}
          testID="create-room-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={handleCreate}
          loading={createMutation.isPending}
          disabled={!supportsWorkspaceScoping || !draft.name.trim() || !draft.workspaceId}
          testID="create-room-submit"
        >
          {createMutation.isPending ? "Creating..." : "Create"}
        </Button>
      </View>
    ),
    [
      createMutation.isPending,
      draft.name,
      draft.workspaceId,
      handleClose,
      handleCreate,
      supportsWorkspaceScoping,
    ],
  );

  return (
    <AdaptiveModalSheet
      header={CREATE_ROOM_HEADER}
      visible={visible}
      onClose={handleClose}
      footer={footer}
      snapPoints={CREATE_ROOM_SNAP_POINTS}
      testID="create-room-sheet"
    >
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <AdaptiveTextInput
          initialValue={draft.name}
          resetKey={`room-name-${inputRevision}`}
          onChangeText={handleNameChange}
          placeholder="Release coordination"
          autoCapitalize="sentences"
          autoCorrect={false}
          editable={!createMutation.isPending}
          testID="create-room-name"
          style={styles.input}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Workspace</Text>
        {allWorkspaceKeys.length === 0 ? (
          <Text style={styles.helper}>No workspaces on this host yet.</Text>
        ) : (
          <>
            {workspaceKeys.length === 0 ? (
              <Text style={styles.helper}>No active workspaces available for a new room.</Text>
            ) : null}
            <View style={styles.workspaceList} testID="create-room-workspace-list">
              {allWorkspaceKeys.map((workspaceId) => (
                <WorkspaceOptionRow
                  key={workspaceId}
                  serverId={serverId}
                  workspaceId={workspaceId}
                  selected={workspaceId === draft.workspaceId}
                  onSelect={handleWorkspaceSelect}
                  onAvailabilityChange={handleWorkspaceAvailabilityChange}
                />
              ))}
            </View>
          </>
        )}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Purpose</Text>
        <AdaptiveTextInput
          initialValue={draft.purpose}
          resetKey={`room-purpose-${inputRevision}`}
          onChangeText={handlePurposeChange}
          placeholder="What this room coordinates"
          multiline
          editable={!createMutation.isPending}
          testID="create-room-purpose"
          style={[styles.input, styles.purposeInput]}
        />
        <Text style={styles.helper}>
          Optional. Keep authority and acceptance rules in the assignment.
        </Text>
      </View>
      {createMutation.error ? (
        <Text style={styles.error} testID="create-room-error">
          {toErrorMessage(createMutation.error)}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function WorkspaceOptionRow({
  serverId,
  workspaceId,
  selected,
  onSelect,
  onAvailabilityChange,
}: {
  serverId: string;
  workspaceId: string;
  selected: boolean;
  onSelect: (workspaceId: string) => void;
  onAvailabilityChange: (workspaceId: string, available: boolean) => void;
}) {
  const workspace = useWorkspace(serverId, workspaceId);
  // A workspace mid-archive can still resolve here, so it must be excluded explicitly
  // rather than relying on absence from the store. A missing descriptor means the
  // workspace no longer resolves and must be excluded too, not treated as available.
  const isArchiving = workspace?.archivingAt != null;
  const isUnavailable = !workspace || isArchiving;
  useEffect(() => {
    onAvailabilityChange(workspaceId, !isUnavailable);
    return () => onAvailabilityChange(workspaceId, true);
  }, [isUnavailable, onAvailabilityChange, workspaceId]);
  const handlePress = useCallback(() => onSelect(workspaceId), [onSelect, workspaceId]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspaceOption,
      selected && styles.workspaceOptionSelected,
      (hovered || pressed) && styles.workspaceOptionHovered,
    ],
    [selected],
  );
  const projectName =
    workspace?.projectCustomName ??
    workspace?.projectDisplayName ??
    projectDisplayNameFromProjectId(workspace?.projectId ?? "");
  const workspaceName = workspace?.title ?? workspace?.name ?? workspaceId;
  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  if (isUnavailable) {
    return null;
  }

  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      testID={`create-room-workspace-${workspaceId}`}
    >
      <Text style={styles.workspaceOptionProject} numberOfLines={1}>
        {projectName}
      </Text>
      <Text style={styles.workspaceOptionName} numberOfLines={1}>
        {workspaceName}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    minHeight: 44,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  workspaceList: {
    gap: theme.spacing[1],
  },
  workspaceOption: {
    minHeight: 44,
    justifyContent: "center",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  workspaceOptionSelected: {
    borderColor: theme.colors.borderAccent,
  },
  workspaceOptionHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceOptionProject: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  workspaceOptionName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  purposeInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
