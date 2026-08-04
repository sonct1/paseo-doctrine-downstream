import { describe, expect, test } from "vitest";
import pino from "pino";
import type { ChatMessage } from "@getpaseo/protocol/chat/types";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { FileBackedChatService } from "../../chat/chat-service.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

class RoomAgentManagerFake {
  public getAgent(agentId: string): ManagedAgent | null {
    if (agentId !== "agent-caller") {
      return null;
    }
    return {
      id: agentId,
      cwd: "/tmp/room-agent",
      workspaceId: "workspace-room",
      internal: false,
      lifecycle: "idle",
      currentModeId: null,
      availableModes: [],
      config: { title: "Room caller" },
    } as ManagedAgent;
  }

  public listAgents(): ManagedAgent[] {
    return [];
  }
}

class RoomAgentStorageFake {
  public async list(): Promise<StoredAgentRecord[]> {
    return [];
  }
}

class RoomChatServiceFake {
  public readonly dispatched: Array<Parameters<FileBackedChatService["dispatchMessage"]>[0]> = [];

  public async readMessages(): Promise<ChatMessage[]> {
    return [];
  }

  public async listRoomPosterAgentIds(): Promise<string[]> {
    return [];
  }

  public async dispatchMessage(
    input: Parameters<FileBackedChatService["dispatchMessage"]>[0],
  ): Promise<ChatMessage> {
    this.dispatched.push(input);
    return {
      id: "message-1",
      roomId: input.room,
      authorAgentId: input.authorAgentId,
      body: input.body,
      replyToMessageId: input.replyToMessageId ?? null,
      mentionAgentIds: [],
      createdAt: "2026-08-04T00:00:00.000Z",
    };
  }
}

function createCatalog(options: {
  callerAgentId?: string;
  chatService?: RoomChatServiceFake;
  enablePosting?: boolean;
}) {
  return createPaseoToolCatalog({
    agentManager: new RoomAgentManagerFake() as unknown as AgentManager,
    agentStorage: new RoomAgentStorageFake() as unknown as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId: options.callerAgentId,
    chatService: options.chatService as unknown as FileBackedChatService,
    ...(options.enablePosting
      ? {
          resolveAgentIdentifier: async (identifier: string) => ({
            ok: true as const,
            agentId: identifier,
          }),
          sendAgentMessage: async () => {},
        }
      : {}),
    logger: pino({ level: "silent" }),
  });
}

describe("Paseo room tools", () => {
  test("only exposes room tools to an agent-scoped catalog", () => {
    const chatService = new RoomChatServiceFake();
    const topLevel = createCatalog({ chatService, enablePosting: true });
    const agentReader = createCatalog({ callerAgentId: "agent-caller", chatService });
    const agentPoster = createCatalog({
      callerAgentId: "agent-caller",
      chatService,
      enablePosting: true,
    });

    expect(topLevel.getTool("read_room")).toBeUndefined();
    expect(topLevel.getTool("post_room")).toBeUndefined();
    expect(agentReader.getTool("read_room")).toBeDefined();
    expect(agentReader.getTool("post_room")).toBeUndefined();
    expect(agentPoster.getTool("post_room")).toBeDefined();
  });

  test("binds post_room author identity to the calling agent", async () => {
    const chatService = new RoomChatServiceFake();
    const catalog = createCatalog({
      callerAgentId: "agent-caller",
      chatService,
      enablePosting: true,
    });

    const result = await catalog.executeTool("post_room", {
      room: "release-room",
      body: "Ready for review",
      authorAgentId: "spoofed-agent",
    });

    expect(chatService.dispatched).toEqual([
      expect.objectContaining({
        room: "release-room",
        body: "Ready for review",
        authorAgentId: "agent-caller",
      }),
    ]);
    expect(result.structuredContent).toEqual({
      message: expect.objectContaining({ authorAgentId: "agent-caller" }),
    });
  });
});
