import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ChatRoomDetailSchema, ChatRoomSchema } from "./types.js";
import { ChatCreateRequestSchema } from "./rpc-schemas.js";

describe("ChatRoomSchema workspace scope compatibility", () => {
  it("parses a legacy room payload with no workspaceId or projectId", () => {
    const legacyRoom = {
      id: "room_1",
      name: "release-coordination",
      purpose: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const parsed = ChatRoomSchema.parse(legacyRoom);
    expect(parsed.workspaceId).toBeUndefined();
    expect(parsed.projectId).toBeUndefined();
  });

  it("parses a workspace-scoped room payload from a new daemon", () => {
    const scopedRoom = {
      id: "room_2",
      name: "council-case_abc",
      purpose: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      workspaceId: "wks_abc",
      projectId: "prj_abc",
    };

    const parsed = ChatRoomSchema.parse(scopedRoom);
    expect(parsed.workspaceId).toBe("wks_abc");
    expect(parsed.projectId).toBe("prj_abc");
  });

  it("an old client parsing a new daemon's scoped room detail ignores the unknown-to-it fields safely", () => {
    const scopedDetail = {
      id: "room_3",
      name: "council-case_def",
      purpose: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      workspaceId: "wks_def",
      projectId: "prj_def",
      messageCount: 0,
      lastMessageAt: null,
    };

    expect(() => ChatRoomDetailSchema.parse(scopedDetail)).not.toThrow();
  });
});

describe("ChatCreateRequestSchema workspace scope compatibility", () => {
  it("parses a legacy create request with no workspaceId", () => {
    const legacyRequest = {
      type: "chat/create" as const,
      requestId: "req_1",
      name: "release-coordination",
    };

    expect(() => ChatCreateRequestSchema.parse(legacyRequest)).not.toThrow();
  });

  it("parses a new client's workspace-scoped create request", () => {
    const scopedRequest = {
      type: "chat/create" as const,
      requestId: "req_2",
      name: "release-coordination",
      workspaceId: "wks_abc",
    };

    const parsed = ChatCreateRequestSchema.parse(scopedRequest);
    expect(parsed.workspaceId).toBe("wks_abc");
  });
});

describe("ChatMessageSchema author provenance compatibility", () => {
  const legacyMessage = {
    id: "message_1",
    roomId: "room_1",
    authorAgentId: "peer_1",
    body: "legacy receipt",
    replyToMessageId: null,
    mentionAgentIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("keeps legacy messages readable without upgrading their provenance", () => {
    expect(ChatMessageSchema.parse(legacyMessage).authorKind).toBeUndefined();
  });

  it("records explicit agent and client provenance on new messages", () => {
    expect(ChatMessageSchema.parse({ ...legacyMessage, authorKind: "agent" }).authorKind).toBe(
      "agent",
    );
    expect(ChatMessageSchema.parse({ ...legacyMessage, authorKind: "client" }).authorKind).toBe(
      "client",
    );
  });
});
