import { z } from "zod";

// COMPAT(chatRooms): retained after the v0.3.0 feature removal; remove after 2027-02-09 when mixed-version peers no longer send legacy messages.

export const ChatRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Added for workspace-scoped Room/Council placement. Optional so old daemons
  // and mixed-version peers parse legacy host-scoped rooms with no scope.
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
});

export type ChatRoom = z.infer<typeof ChatRoomSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  authorAgentId: z.string(),
  // COMPAT(chatAuthorProvenance): legacy persisted messages have no provenance.
  // They remain readable, but security-sensitive consumers must require an
  // explicit agent provenance before accepting a message as agent-authored.
  authorKind: z.enum(["agent", "client"]).optional(),
  body: z.string(),
  replyToMessageId: z.string().nullable(),
  mentionAgentIds: z.array(z.string()),
  createdAt: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRoomDetailSchema = ChatRoomSchema.extend({
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().nullable(),
});

export type ChatRoomDetail = z.infer<typeof ChatRoomDetailSchema>;
