import { useEffect, useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "@getpaseo/protocol/chat/types";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useFetchQuery } from "@/data/query";
import { toErrorMessage } from "@/utils/error-messages";
import { mergeChatMessages } from "./model";

const ROOM_MESSAGE_LIMIT = 100;
const ROOM_WAIT_TIMEOUT_MS = 15_000;

export const roomQueryKeys = {
  list: (serverId: string) => ["rooms", serverId] as const,
  messages: (serverId: string, roomId: string) => ["roomMessages", serverId, roomId] as const,
};

export function useRoomsQuery(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsRooms = useHostFeature(serverId, "chatRooms");
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);

  const query = useFetchQuery({
    queryKey: [...roomQueryKeys.list(serverId), runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) {
        throw new Error("Host client unavailable");
      }
      const response = await client.listChatRooms();
      if (response.error) {
        throw new Error(response.error);
      }
      return response.rooms;
    },
    enabled: Boolean(serverId && client && isConnected && supportsRooms),
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  return { ...query, supportsRooms, isConnected, client };
}

export function useRoomMessagesQuery(serverId: string, roomId: string | null) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsRooms = useHostFeature(serverId, "chatRooms");

  return useFetchQuery({
    queryKey: roomQueryKeys.messages(serverId, roomId ?? ""),
    queryFn: async () => {
      if (!client || !roomId) {
        throw new Error("Room client unavailable");
      }
      const response = await client.readChatMessages({ room: roomId, limit: ROOM_MESSAGE_LIMIT });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.messages;
    },
    enabled: Boolean(serverId && roomId && client && isConnected && supportsRooms),
    retry: false,
    dataShape: "list",
    staleTimeMs: 0,
  });
}

interface RoomLiveState {
  error: string | null;
  revision: number;
}

type RoomLiveAction = { type: "started" } | { type: "failed"; error: string } | { type: "retry" };

function reduceRoomLiveState(state: RoomLiveState, action: RoomLiveAction): RoomLiveState {
  if (action.type === "started") {
    return state.error === null ? state : { ...state, error: null };
  }
  if (action.type === "failed") {
    return { ...state, error: action.error };
  }
  return { error: null, revision: state.revision + 1 };
}

export function useRoomLiveMessages(input: {
  serverId: string;
  roomId: string | null;
  enabled: boolean;
}) {
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reduceRoomLiveState, { error: null, revision: 0 });

  useEffect(() => {
    if (!input.enabled || !input.roomId || !client || !isConnected) {
      return;
    }

    let active = true;
    const roomId = input.roomId;
    const activeClient = client;
    const queryKey = roomQueryKeys.messages(input.serverId, roomId);
    const currentMessages = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];
    let cursor = currentMessages.at(-1)?.id;
    dispatch({ type: "started" });

    async function waitForMessages(): Promise<void> {
      for (;;) {
        if (!active) {
          return;
        }
        try {
          const response = await activeClient.waitForChatMessages({
            room: roomId,
            afterMessageId: cursor,
            timeoutMs: ROOM_WAIT_TIMEOUT_MS,
          });
          if (!active) {
            return;
          }
          if (response.error) {
            throw new Error(response.error);
          }
          if (response.messages.length === 0) {
            continue;
          }
          cursor = response.messages.at(-1)?.id ?? cursor;
          queryClient.setQueryData<ChatMessage[]>(queryKey, (messages = []) =>
            mergeChatMessages(messages, response.messages),
          );
          void queryClient.invalidateQueries({ queryKey: roomQueryKeys.list(input.serverId) });
        } catch (error) {
          if (active) {
            dispatch({ type: "failed", error: toErrorMessage(error) });
          }
          return;
        }
      }
    }

    void waitForMessages();
    return () => {
      active = false;
    };
  }, [
    client,
    input.enabled,
    input.roomId,
    input.serverId,
    isConnected,
    queryClient,
    state.revision,
  ]);

  return {
    error: state.error,
    retry: () => dispatch({ type: "retry" }),
  };
}
