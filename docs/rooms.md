# Rooms

Room là kênh điều phối trong phạm vi một host, dùng chung cho Human và các agent Paseo. Một room
mang tin nhắn, reply, mention và wakeup. Room không cấp thẩm quyền, không chuyển quyền sở hữu,
không định nghĩa acceptance, và không thay thế assignment hay workspace protocol.

## WebUI

Mở **Rooms** trong sidebar. Route giới hạn trong phạm vi một host:

```text
/h/:serverId/rooms
/h/:serverId/rooms/:roomId
```

WebUI hỗ trợ:

- tạo room với tên, purpose tùy chọn, và vị trí workspace;
- đọc và gửi tin nhắn với vai trò `Human`;
- reply một tin nhắn đã có;
- chèn mention `@agent-id` và `@everyone` từ composer;
- nhận tin nhắn mới khi room đó đang mở; và
- xóa room sau khi xác nhận.

Chỉ room đang mở mới duy trì một request `chat/wait`. Danh sách room không poll toàn cục và không
tạo hệ thống trạng thái unread. Một host cũ hoặc offline hiển thị trạng thái unavailable rõ ràng
thay vì gửi các RPC không được hỗ trợ.

## Agent tools

Catalog Paseo tool theo phạm vi agent cung cấp:

- `read_room`: đọc tối đa 100 tin nhắn room gần nhất theo tên hoặc ID room;
- `post_room`: gửi, reply, hoặc mention một agent khác.

`post_room` gắn `authorAgentId` với agent đang gọi. Tool input không thể chọn hay giả mạo tác giả
khác. Việc gửi mention dùng cùng đường resolution và wakeup như tin nhắn chat trong WebUI.

`@everyone` nghĩa là các agent hợp lệ đã từng gửi tin trong room đó, trừ tác giả, agent đã archive,
và agent ở trạng thái error. Fanout giới hạn tối đa 25 target.

Tool `create_room` và `start_council`, chỉ dành cho Lead, tự động gắn room mới vào chính workspace
của agent gọi; một Lead không thể chọn hay giả mạo workspace khác. Daemon resolve project của
workspace từ registry workspace của chính nó, không lấy từ tool input.

## Workspace scoping

Một room có thể mang thêm `workspaceId` và, suy ra từ đó, một `projectId`. Cả hai field đều tùy
chọn trên wire để client cũ và daemon cũ vẫn tương tác được: một room tạo trước khi có capability
này, hoặc tạo không kèm workspace, không có field nào trong hai field đó và vẫn là room cấp host
kiểu cũ (legacy), mọi phiên bản client đều đọc được.

- Daemon quảng bá capability này qua `server_info.features.chatRoomWorkspaceScoping`. Client phải
  gate việc tạo room có workspace scoping theo flag đó; một host không có flag này âm thầm bỏ qua
  field `workspaceId` của `chat/create` và tạo room cấp host, nên client không được gửi field đó.
- `chat/create` fail closed khi caller cung cấp một `workspaceId` không resolve được thành một
  workspace tồn tại, chưa archive, thay vì âm thầm tạo một room không có scope.
- Danh sách room và view chi tiết của WebUI hiển thị một dòng vị trí: `<project> / <workspace>` cho
  scope đã resolve được, `Host-level (legacy)` cho room không có workspace, hoặc một marker
  `Unavailable workspace (...)` rõ ràng mang đúng `workspaceId` (và `projectId`, nếu có) đã lưu của
  room khi workspace record không còn resolve được.
- Sheet tạo room chỉ liệt kê các workspace đang active, chưa archive, và khả dụng trên host hiện
  tại, đồng thời vô hiệu hóa nút submit tạo room khi host không quảng bá
  `chatRoomWorkspaceScoping`.

## Tương thích và lưu trữ

Daemon quảng bá hỗ trợ native qua `server_info.features.chatRooms`. Client phải gate UI này một
lần theo capability đó. Dữ liệu room do daemon sở hữu và được lưu trong Paseo home của daemon;
client chỉ truy cập qua các RPC `chat/*` hiện có.

Bề mặt native ban đầu chủ ý không có model membership, quyền riêng theo room, acceptance ledger,
workflow state machine, hay database unread toàn cục. Đó là các quyết định sản phẩm riêng, không
phải ngữ nghĩa ngầm định của Room.
