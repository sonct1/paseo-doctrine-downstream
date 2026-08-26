import type { ChatMessage, ChatRoomDetail } from "@getpaseo/protocol/chat/types";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { buildHostRoomsRoute } from "../../src/utils/host-routes";

interface RoomSeedClient {
  createChatRoom(input: {
    name: string;
    purpose?: string;
  }): Promise<{ room: ChatRoomDetail | null; error: string | null }>;
  deleteChatRoom(input: {
    room: string;
  }): Promise<{ room: ChatRoomDetail | null; error: string | null }>;
  postChatMessage(input: {
    room: string;
    body: string;
    authorAgentId?: string;
    replyToMessageId?: string;
  }): Promise<{ message: ChatMessage | null; error: string | null }>;
  readChatMessages(input: {
    room: string;
    limit?: number;
  }): Promise<{ messages: ChatMessage[]; error: string | null }>;
}

test.describe("Rooms", () => {
  test("creates, posts, receives live messages, replies, and deletes in the WebUI", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "release-room-" });
    const seedClient = workspace.client;
    const roomClient = seedClient as unknown as RoomSeedClient;
    const serverId = getServerId();
    const roomName = `Release room ${Date.now()}`;
    let roomId: string | null = null;

    try {
      await gotoAppShell(page);
      const roomsNav = page.locator('[data-testid="sidebar-rooms"]:visible').first();
      await expect(roomsNav).toBeVisible({ timeout: 30_000 });
      await roomsNav.click();
      await expect(page).toHaveURL(buildHostRoomsRoute(serverId));
      await expect(page.getByTestId("rooms-screen")).toBeVisible();

      await page.getByTestId("rooms-create").click();
      await expect(page.getByTestId("create-room-sheet")).toBeVisible();
      await page.getByTestId("create-room-name").fill("Discarded room draft");
      await page.getByTestId("create-room-cancel").click();
      await page.getByTestId("rooms-create").click();
      await expect(page.getByTestId("create-room-name")).toHaveValue("");
      await page.getByTestId("create-room-name").fill(roomName);
      await page.getByTestId("create-room-purpose").fill("Coordinate the release handoff");
      const workspaceOption = page.getByTestId(`create-room-workspace-${workspace.workspaceId}`);
      await expect(workspaceOption).toBeVisible({ timeout: 30_000 });
      await workspaceOption.click();
      await page.getByTestId("create-room-submit").click();

      const roomDetail = page.locator('[data-testid^="room-detail-"]').first();
      await expect(roomDetail).toBeVisible({ timeout: 30_000 });
      roomId = (await roomDetail.getAttribute("data-testid"))?.replace("room-detail-", "") ?? null;
      expect(roomId).toBeTruthy();
      await expect(page.getByText(roomName, { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId("room-detail-placement")).toContainText(
        `/ ${workspace.workspaceName}`,
      );

      const composer = page.getByTestId("room-composer-input");
      await composer.fill("@eve");
      await expect(page.getByTestId("room-mention-everyone")).toBeVisible();
      await page.getByTestId("room-mention-everyone").click();
      await expect(composer).toHaveValue("@everyone ");
      await composer.pressSequentially("Human kickoff");
      await page.getByTestId("room-send").click();
      await expect(
        page
          .locator('[data-testid^="room-message-"]')
          .getByText("@everyone Human kickoff", { exact: true }),
      ).toBeVisible();

      const firstRead = await roomClient.readChatMessages({ room: roomId!, limit: 20 });
      expect(firstRead.error).toBeNull();
      const kickoff = firstRead.messages.find(
        (message) => message.body === "@everyone Human kickoff",
      );
      expect(kickoff).toBeDefined();

      const livePost = await roomClient.postChatMessage({
        room: roomId!,
        body: "External client status arrived live",
      });
      expect(livePost.error).toBeNull();
      await expect(
        page
          .locator('[data-testid^="room-message-"]')
          .getByText("External client status arrived live", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      await page
        .getByTestId(`room-message-${kickoff!.id}`)
        .getByRole("button", { name: "Reply" })
        .click();
      await expect(page.getByText("Replying to Human", { exact: true })).toBeVisible();
      await composer.fill("Acknowledged");
      await page.getByTestId("room-send").click();
      await expect(
        page.locator('[data-testid^="room-message-"]').getByText("Acknowledged", { exact: true }),
      ).toBeVisible();

      const replyRead = await roomClient.readChatMessages({ room: roomId!, limit: 20 });
      const reply = replyRead.messages.find((message) => message.body === "Acknowledged");
      expect(reply?.replyToMessageId).toBe(kickoff!.id);

      const deletedRoomId = roomId!;
      page.once("dialog", async (dialog) => dialog.accept());
      await page.getByTestId("room-delete").click();
      await expect(page).toHaveURL(buildHostRoomsRoute(serverId));
      await expect(page.getByTestId(`room-row-${deletedRoomId}`)).toHaveCount(0);
      await expect(page.getByTestId(`room-detail-${deletedRoomId}`)).toHaveCount(0);
      await expect(page.getByText(roomName, { exact: true })).toHaveCount(0);
      roomId = null;
    } finally {
      if (roomId) {
        await roomClient.deleteChatRoom({ room: roomId }).catch(() => undefined);
      }
      await workspace.cleanup();
    }
  });
});
