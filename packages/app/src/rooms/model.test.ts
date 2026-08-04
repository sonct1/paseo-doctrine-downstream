import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@getpaseo/protocol/chat/types";
import { findActiveRoomMention, insertRoomMention, mergeChatMessages } from "./model";

function message(id: string, createdAt: string): ChatMessage {
  return {
    id,
    roomId: "room-1",
    authorAgentId: "agent-1",
    body: id,
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt,
  };
}

describe("room model", () => {
  it("merges realtime messages without duplicates and keeps wire order", () => {
    const first = message("first", "2026-08-04T01:00:00.000Z");
    const second = message("second", "2026-08-04T01:01:00.000Z");
    expect(mergeChatMessages([first], [second, first])).toEqual([first, second]);
  });

  it("finds the mention at the active cursor and ignores email-like text", () => {
    expect(findActiveRoomMention("ask @peer", 9)).toEqual({ start: 4, end: 9, query: "peer" });
    expect(findActiveRoomMention("mail a@b.com", 12)).toBeNull();
  });

  it("inserts a canonical agent id and preserves text after the cursor", () => {
    expect(insertRoomMention("ask @pe now", 7, "peer-agent")).toEqual({
      text: "ask @peer-agent now",
      cursor: 16,
    });
  });
});
