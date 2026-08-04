import { useCallback, useMemo, useReducer } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ChatRoomDetail } from "@getpaseo/protocol/chat/types";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { toErrorMessage } from "@/utils/error-messages";

interface CreateRoomSheetProps {
  client: DaemonClient | null;
  visible: boolean;
  onClose: () => void;
  onCreated: (room: ChatRoomDetail) => void;
}

interface CreateRoomDraft {
  name: string;
  purpose: string;
}

type CreateRoomDraftAction =
  | { type: "name"; value: string }
  | { type: "purpose"; value: string }
  | { type: "reset" };

const EMPTY_DRAFT: CreateRoomDraft = { name: "", purpose: "" };
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
  return EMPTY_DRAFT;
}

export function CreateRoomSheet({ client, visible, onClose, onCreated }: CreateRoomSheetProps) {
  const [draft, dispatch] = useReducer(reduceCreateRoomDraft, EMPTY_DRAFT);
  const [inputRevision, bumpInputRevision] = useReducer((revision: number) => revision + 1, 0);
  const createMutation = useMutation({
    mutationFn: async (): Promise<ChatRoomDetail> => {
      if (!client) {
        throw new Error("Host client unavailable");
      }
      const response = await client.createChatRoom({
        name: draft.name.trim(),
        purpose: draft.purpose.trim() || undefined,
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
          disabled={!draft.name.trim()}
          testID="create-room-submit"
        >
          {createMutation.isPending ? "Creating..." : "Create"}
        </Button>
      </View>
    ),
    [createMutation.isPending, draft.name, handleClose, handleCreate],
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
