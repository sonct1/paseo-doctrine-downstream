import type pino from "pino";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { ManagedAgent } from "../agent/agent-manager.js";
import {
  ChatServiceError,
  type FileBackedChatService,
  parseMentionAgentIds,
} from "./chat-service.js";
import { notifyChatMentions, prepareChatMentionFanout } from "./chat-mentions.js";

export interface PostChatMessageWithMentionsInput {
  chatService: FileBackedChatService;
  room: string;
  authorAgentId: string;
  authorKind: "agent" | "client";
  body: string;
  replyToMessageId?: string | null;
  logger: pino.Logger;
  listStoredAgents: () => Promise<StoredAgentRecord[]>;
  listLiveAgents: () => ManagedAgent[];
  resolveAgentIdentifier: (
    identifier: string,
  ) => Promise<{ ok: true; agentId: string } | { ok: false; error: string }>;
  sendAgentMessage: (agentId: string, text: string) => Promise<void>;
}

export async function postChatMessageWithMentions(input: PostChatMessageWithMentionsInput) {
  const mentionAgentIds = parseMentionAgentIds(input.body);
  const storedAgents = await input.listStoredAgents();
  const liveAgents = input.listLiveAgents();
  const fanout = await prepareChatMentionFanout({
    authorAgentId: input.authorAgentId,
    mentionAgentIds,
    storedAgents,
    liveAgents,
    listRoomPosterAgentIds: () => input.chatService.listRoomPosterAgentIds({ room: input.room }),
  });
  if (!fanout.ok) {
    throw new ChatServiceError("chat_mention_fanout_limit_exceeded", fanout.error);
  }

  const message = await input.chatService.dispatchMessage({
    room: input.room,
    authorAgentId: input.authorAgentId,
    authorKind: input.authorKind,
    body: input.body,
    replyToMessageId: input.replyToMessageId,
  });

  void notifyChatMentions({
    room: input.room,
    authorAgentId: input.authorAgentId,
    body: input.body,
    mentionAgentIds: message.mentionAgentIds,
    logger: input.logger,
    storedAgents,
    liveAgents,
    prepared: fanout.prepared,
    resolveAgentIdentifier: input.resolveAgentIdentifier,
    sendAgentMessage: input.sendAgentMessage,
  });

  return message;
}
