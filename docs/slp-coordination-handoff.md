# SLP: coordination signal và adjacent-Lead handoff

Tài liệu này mô tả cách Supervisor, Lead và Peer dùng coordination signal và handoff trong Paseo.
Nó không thay thế role contracts, Human lease hoặc repository protocol.

## Mức trưởng thành hiện tại

| Slice                  | Trạng thái                              | Đã có                                                                                                                    | Chưa được chứng minh                                      |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| P0 coordination signal | Candidate, integrated-runtime-qualified | protocol, persistence, idle-boundary delivery, native paid-provider resolution, CLI/client/tool, native attention policy | release activation, multi-day operational effect          |
| P1 manual handoff      | Pilot đã chạy                           | predecessor packet, independent successor review, rejection evidence                                                     | multi-day operational effect                              |
| P2 handoff artifact    | Candidate, isolated-runtime-qualified   | immutable packet core, explicit ordered receipts, role/Human gates, restart readback                                     | release activation, multi-day effect và lease enforcement |

Không được gọi ba slice này là shipped production capability chỉ vì focused tests xanh.

## Coordination signal

Coordination signal là durable advisory attention. Nó không phải prompt điều khiển và không chuyển
authority.

- Human dùng paseo agent signal.
- Role-bound Lead hoặc Supervisor dùng signal_agent.
- Receiving role dùng resolve_agent_signal.
- Nếu target đang chạy, daemon persist signal ngay nhưng chờ idle boundary để delivery; active run
  không bị replace.
- Manual handoff/detach recommendation chỉ target role-bound Lead.
- Native continuity attention dùng provider telemetry hoặc repeated terminal failures. Missing context
  telemetry fail closed.

Ví dụ:

    paseo agent signal <lead-id> --kind handoff --reason "Context dilution after repeated reopen"
    paseo agent signal <lead-id> --kind detach --related-agent <agent-id> --reason "Review whether this child should become independent"

Detach recommendation không promote agent. Detach thật chỉ xóa parent label và vẫn cần exact
Human-facing lifecycle action.

## Routing SLP

- Peer failure lặp lại ba lần liên tiếp route attention tới owning Lead hoặc unique workspace Lead.
- Lead failure lặp lại ba lần liên tiếp chỉ route tới unique workspace Supervisor.
- Context pressure và provider compaction route về chính Lead để Lead tự đánh giá continuity.
- Supervisor quan sát và khuyến nghị; không seize implementation ownership.
- Lead giữ routing, integration và engineering acceptance trong Human lease.
- Peer không signal, transition hoặc tạo handoff; Peer chỉ handback evidence cho Lead.

Completed hoặc canceled turn reset repeated-failure sequence. Canceled turn không được tính là failure.
Unresolved native attention coalesce để tránh prompt storm.

## Adjacent-Lead handoff

Handoff này khác ordinary task handoff và khác detach. Nó dùng một frozen packet trước khi successor
được authorize.

Packet bắt buộc có:

- objective, scope, current state và stop condition;
- current write Owner;
- accepted decisions;
- failed approaches và successful patterns;
- concrete evidence index;
- active risks/blockers;
- exact resume point.

State flow:

    packet_ready
      -> successor_authorized
      -> successor_acknowledged
      -> predecessor_released

Successor có thể reject packet thiếu hoặc sai trước authorization. Packet core không bị rewrite sau khi
persist; chỉ coordination metadata và receipts tiến theo transition.

Authority:

- Predecessor Lead gọi prepare_lead_handoff tại bounded stop point.
- Human-facing caller designate exact role-bound successor cùng workspace và record
  successor_authorized.
- Chỉ designated successor Lead được record successor_acknowledged hoặc rejection của chính nó.
- Chỉ Human-facing caller được record predecessor_released.

Receipt không tự detach, archive, stop, đổi role binding hoặc enforce write lease. Mỗi thời điểm vẫn chỉ
có một actual write Owner theo Human/repository authority. Nếu runtime tools chưa available, dừng ở
manual frozen packet và báo UNKNOWN; không dùng chat prose giả làm receipt.

## Skill usage

Skill paseo-handoff phân loại hai lane:

- Ordinary task transfer: tạo receiving agent với self-contained briefing; agent vẫn là subagent cho tới
  khi Human detach thủ công.
- Adjacent-Lead continuity: packet first, Human authorization, successor ACK, Human release.

Skill paseo-supervisor chỉ phát hiện friction, signal và đề xuất bounded correction theo mandate. Skill
không tự cấp replacement lease. Skill paseo là lifecycle/reference plane và vẫn là nơi resolve provider,
workspace, agent và runtime status.

## Evidence

P1 rejection, rationale, isolated P2 runtime qualification và integrated P0 callable-surface canary được giữ tại
docs/research/p1-adjacent-lead-handoff-pilot-2026-08-08.md. Candidate P2 trực tiếp bắt buộc các field mà
successor đã chỉ ra là thiếu. P0 canary chứng minh native tool invocation và durable state readback trên
paid Codex Lead; P2 qualification chứng minh ordered workflow và durable readback trong dev daemon cô
lập. Hai bằng chứng chưa chứng minh release activation, production operation hoặc write-lease
enforcement.
