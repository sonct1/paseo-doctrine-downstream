import type { ChatMessage } from "@getpaseo/protocol/chat/types";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface ActiveRoomMention {
  start: number;
  end: number;
  query: string;
}

export interface RoomPlacement {
  text: string;
  legacy: boolean;
}

const ROOM_PLACEMENT_LEGACY: RoomPlacement = { text: "Host-level (legacy)", legacy: true };

export function describeRoomPlacement(
  room: { workspaceId?: string; projectId?: string },
  workspace: WorkspaceDescriptor | null,
): RoomPlacement {
  if (!room.workspaceId) {
    return ROOM_PLACEMENT_LEGACY;
  }
  if (!workspace) {
    // The workspace record is gone (or not yet hydrated), but the room's own
    // scope IDs are still authoritative persisted state. Surface them exactly
    // rather than collapsing to a bare "unknown" that hides which workspace
    // and project this room was actually bound to.
    const idLabels = [
      room.projectId ? `project: ${room.projectId}` : null,
      `workspace: ${room.workspaceId}`,
    ].filter((label): label is string => label !== null);
    return { text: `Unavailable workspace (${idLabels.join(", ")})`, legacy: true };
  }
  const projectName =
    workspace.projectCustomName ??
    workspace.projectDisplayName ??
    projectDisplayNameFromProjectId(workspace.projectId);
  const workspaceName = workspace.title ?? workspace.name;
  return { text: `${projectName} / ${workspaceName}`, legacy: false };
}

export interface InsertRoomMentionResult {
  text: string;
  cursor: number;
}

export function mergeChatMessages(
  currentMessages: readonly ChatMessage[],
  incomingMessages: readonly ChatMessage[],
): ChatMessage[] {
  const messagesById = new Map<string, ChatMessage>();
  for (const message of currentMessages) {
    messagesById.set(message.id, message);
  }
  for (const message of incomingMessages) {
    messagesById.set(message.id, message);
  }
  return Array.from(messagesById.values()).sort((left, right) => {
    const timeOrder = left.createdAt.localeCompare(right.createdAt);
    return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id);
  });
}

export function findActiveRoomMention(text: string, cursor: number): ActiveRoomMention | null {
  const boundedCursor = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, boundedCursor);
  const match = beforeCursor.match(/(?:^|\s)@([A-Za-z0-9._-]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const leadingWhitespaceLength = match[0].startsWith("@") ? 0 : 1;
  const start = match.index + leadingWhitespaceLength;
  return {
    start,
    end: boundedCursor,
    query: match[1] ?? "",
  };
}

export function insertRoomMention(
  text: string,
  cursor: number,
  agentId: string,
): InsertRoomMentionResult {
  const activeMention = findActiveRoomMention(text, cursor);
  if (!activeMention) {
    return { text, cursor };
  }
  const prefix = text.slice(0, activeMention.start);
  const suffix = text.slice(activeMention.end).replace(/^\s/, "");
  const mention = `@${agentId} `;
  return {
    text: `${prefix}${mention}${suffix}`,
    cursor: prefix.length + mention.length,
  };
}
