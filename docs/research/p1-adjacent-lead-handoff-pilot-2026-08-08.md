# P1 adjacent-Lead handoff pilot — 2026-08-08

## Scope

Pilot chạy trên isolated dev daemon tại 127.0.0.1:6768 và isolated Paseo home của worktree
codex/slp-handoff-p0-p2. Hai role-bound Codex Leads dùng cùng workspace. Cả hai assignment đều
read-only; không sửa file, chạy test, tạo child, detach hoặc archive.

## Predecessor

- Agent: cb5a1d68-5564-4c2f-9383-d871c5cd58da
- Kết quả: HANDOFF_PACKET_READY
- Packet có objective, scope, current state, decisions, high-level evidence refs, unresolved risks,
  next action và stop condition.

## Successor

- Agent: 040e4059-2a61-44dc-9ec9-60e029ad7368
- Kết quả: SUCCESSOR_REJECT

Successor independently đọc current research doc và git status. Nó xác nhận objective, branch và các
decision chính, nhưng reject packet vì thiếu:

- explicit current lease/mutation-owner ledger;
- failed-approaches list;
- successful-patterns list;
- concrete evidence index;
- explicit active risks/blockers;
- exact successor continuation point.

Successor không claim predecessor release.

## Decision

P1 không chứng minh narrative packet là đủ. Rejection là evidence hợp lệ để P2 bắt buộc các field trên,
tách Human authorization, successor acknowledgement và predecessor release thành receipts riêng, đồng
thời giữ detach/archive/role mutation ngoài workflow.

## P2 isolated runtime qualification

Sau khi implementation hoàn tất, cùng isolated dev daemon đã chạy exact packet-first workflow:

- predecessor Lead `6fa5b57c-8266-4a04-b5f0-64a7e213f240` prepare packet
  `b9e46fa6-cb8b-4e84-b56d-198c385dec7c` ở trạng thái `packet_ready`, chưa có successor;
- chỉ sau đó mới tạo successor Lead `18064b7e-782c-4731-a0f3-a1fe21f78962`;
- Human-facing caller authorize exact successor;
- successor independently inspect packet rồi record `successor_acknowledged`;
- Human-facing caller chỉ record `predecessor_released` sau acknowledgement.

Restart readback trả packet ở trạng thái `predecessor_released` với ba receipt theo đúng thứ tự:
`successor_authorized`, `successor_acknowledged`, `predecessor_released`. `actorAgentId` lần lượt là
`null`, exact successor ID, `null`. Cả hai agent có `archivedAt: null`; workflow không detach, archive,
đổi role binding hoặc chuyển write lease. Sau daemon restart, runtime projection là `closed`, phù hợp với
durable record chưa được initialize lại và không phải handoff lifecycle mutation.

Hai activation finding có giá trị:

- agent-scoped tools fail closed khi isolated config chưa bật `daemon.mcp.injectIntoAgents`;
- live status ban đầu bỏ sót persisted handoff metadata; merge projection được sửa và restart readback
  xác nhận packet cùng receipts hiện diện.

## Residual unknowns

- Chưa có multi-day evidence về continuity improvement.
- Candidate P2 đã qualified trên isolated runtime, chưa release-activated hoặc production-qualified.
- Receipt ghi nhận authority decision nhưng chưa enforce runtime write lease.
- Cooling, corroboration và predecessor retention policy vẫn là open doctrine decisions.
