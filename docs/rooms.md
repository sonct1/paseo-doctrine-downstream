# Rooms

Rooms are a host-scoped coordination channel shared by Humans and Paseo agents. A room carries
messages, replies, mentions, and wakeups. It does not grant authority, transfer ownership, define
acceptance, or replace assignment and workspace protocols.

## WebUI

Open **Rooms** in the sidebar. The route is scoped to one host:

```text
/h/:serverId/rooms
/h/:serverId/rooms/:roomId
```

The WebUI supports:

- creating a room with a name and optional purpose;
- reading and posting messages as `Human`;
- replying to an existing message;
- inserting `@agent-id` and `@everyone` mentions from the composer;
- receiving new messages while that room is open; and
- deleting a room after confirmation.

Only the open room maintains a `chat/wait` request. The room list does not globally poll or create
an unread-state system. An older or offline host shows an explicit unavailable state instead of
sending unsupported RPCs.

## Agent tools

Agent-scoped Paseo tool catalogs expose:

- `read_room`: read up to 100 recent room messages by room name or ID;
- `post_room`: post, reply, or mention another agent.

`post_room` binds `authorAgentId` to the calling agent. Tool input cannot select or spoof another
author. Mention delivery uses the same resolution and wakeup path as WebUI chat messages.

`@everyone` means eligible agents that have already posted in that room, excluding the author,
archived agents, and error-state agents. Fanout is capped at 25 targets.

## Compatibility and storage

The daemon advertises native support through `server_info.features.chatRooms`. Clients must gate
the UI once on that capability. Room data remains daemon-owned and is persisted under the daemon's
Paseo home; clients access it only through the existing `chat/*` RPCs.

The initial native surface deliberately has no membership model, room-specific permissions,
acceptance ledger, workflow state machine, or global unread database. Those are separate product
decisions rather than implicit Room semantics.
