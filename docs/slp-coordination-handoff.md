# SLP: coordination signal và adjacent-Lead handoff

Tài liệu này mô tả cách Supervisor, Lead và Peer dùng coordination signal và handoff trong Paseo.
Nó không thay thế role contracts, Human lease hoặc repository protocol.

## Mức trưởng thành hiện tại

| Slice                  | Trạng thái                                           | Đã có                                                                                                                               | Chưa được chứng minh                             |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| P0 coordination signal | Candidate, integrated-runtime-qualified, default-off | protocol, persistence, idle-boundary delivery, native paid-provider resolution, CLI/client/tool, flag-gated native attention policy | release activation, multi-day operational effect |
| P1 manual handoff      | Pilot đã chạy                                        | predecessor packet, independent successor review, rejection evidence                                                                | multi-day operational effect                     |
| P2 handoff artifact    | Candidate, integrated-runtime-qualified              | immutable packet core, explicit ordered receipts, role/Human gates, write-lease enforcement, paid-provider release canary           | release activation, multi-day operational effect |

Không được gọi ba slice này là shipped production capability chỉ vì focused tests xanh.

Các tool candidate không được project vào standing role profile mặc định. Human phải enable exact tool
trong Role Profiles sau khi chấp nhận use case và evidence boundary; việc tool còn nằm trong Foundation
ceiling chỉ cho phép opt-in, không phải production endorsement.

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
- Automatic native policy không start mặc định; internal pilot phải đặt exact
  `PASEO_ENABLE_NATIVE_COORDINATION_POLICY=1`. Manual signal và pending safe-boundary delivery không phụ
  thuộc flag này.

Ví dụ:

    paseo agent signal <lead-id> --kind handoff --reason "Context dilution after repeated reopen"
    paseo agent signal <lead-id> --kind detach --related-agent <agent-id> --reason "Review whether this child should become independent"

Detach recommendation không promote agent. Detach thật chỉ xóa parent label và vẫn cần exact
Human-facing lifecycle action.

## Routing SLP

- Peer failure lặp lại ba lần liên tiếp route attention tới owning Lead hoặc unique workspace Lead.
- Lead failure lặp lại ba lần liên tiếp chỉ route tới unique workspace Supervisor.
- Context pressure và provider compaction route về chính Lead để Lead tự đánh giá continuity.
- Một context-pressure hoặc compaction event có thể tạo một advisory attention để tránh bỏ lỡ tín hiệu
  quan trọng, nhưng riêng signal đó không đủ để trigger replacement, handoff hay authority change.
- Supervisor quan sát và khuyến nghị; không seize implementation ownership.
- Lead giữ routing, integration và engineering acceptance trong Human lease.
- Peer không signal, transition hoặc tạo handoff; Peer chỉ handback evidence cho Lead.

Completed hoặc canceled turn reset repeated-failure sequence. Canceled turn không được tính là failure.
Unresolved native attention coalesce để tránh prompt storm.

### Cooling và corroboration

- Human explicit action không có elapsed-time cooling window. Khi frozen packet đầy đủ, successor đã
  ACK và predecessor ở safe idle boundary, Human có thể authorize hoặc release ngay.
- Automated heuristic không được đổi authority. Một signal đơn chỉ là advisory; authority-changing
  correction chỉ được đề xuất sau repeated evidence hoặc corroboration từ independent runtime state,
  durable receipt, current bytes hay một episode khác.
- Repeated terminal failure hiện dùng ngưỡng ba lần liên tiếp. Context pressure và automatic compaction
  có thể cảnh báo ngay một lần, nhưng vẫn để Lead/Human quyết định có cần handoff hay không.
- Dù evidence đã corroborated, adjacent-Lead transfer vẫn cần exact Human authorization và final Human
  release; corroboration không tự cấp lease.

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

Các receipt trước final release không đổi authority. `predecessor_released` chỉ được ghi ở idle boundary;
transition này đóng predecessor runtime, giữ durable record, rồi chuyển `currentWriteOwnerAgentId` sang
successor. Nếu runtime closure lỗi thì transition không được persist và Owner không đổi. Sau release,
daemon từ chối mọi prompt mới hoặc unarchive-and-prompt cho predecessor bằng
`agent_write_lease_released`. Nó không detach, archive hoặc đổi role binding; durable packet, receipts và
timeline vẫn được giữ để audit. Final release lock cả predecessor lẫn successor theo stable identity
order và revalidate successor ngay trước transfer. Existing close được join thay vì bỏ qua; close failure
được nhớ tới daemon restart và không thể biến thành success bằng retry. Close wait bị bound ở 10 giây để
không giữ successor authority lock vô hạn. Timeline audit đọc durable store mà không resume provider
runtime; mỗi timeline batch ghi durable pending manifest trước các row files. Final release reconcile
pending manifests — kể cả sau daemon restart — rồi fail closed nếu durability vẫn lỗi. Nếu boundary 10
giây timeout trước khi close bắt đầu, abort signal ngăn continuation cũ đóng predecessor về sau. Lỗi xảy
ra trước lúc manifest được tạo vẫn nằm trong daemon repair ledger và chặn release/graceful shutdown;
per-agent drain được serialize và graceful shutdown attempt mọi known repair trước khi aggregate lỗi.
Hard process loss đúng interval đó là storage-failure boundary chưa qualified, không được claim recover.
Released predecessor identity không được tái dùng làm successor; một handoff quay lại cùng người/vai trò
phải tạo fresh role-bound Lead identity để historical revocation không nhập nhằng. Durable timeline
retention áp dụng cho handoff chạy sau khi file-backed store được activate; candidate receipts cũ hơn vẫn
giữ packet/receipts nhưng không được claim có timeline backfill. Nếu runtime tools chưa available, dừng ở
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

P1 rejection, rationale, isolated P2 runtime qualification và integrated P0 callable-surface canary được
giữ tại docs/research/p1-adjacent-lead-handoff-pilot-2026-08-08.md. Candidate P2 trực tiếp bắt buộc các
field mà successor đã chỉ ra là thiếu. P0 canary chứng minh native tool invocation và durable state
readback trên paid Codex Lead. Fresh staged canary chứng minh successor ACK qua deferred native tool
discovery trên source `191e4eb9a`, rồi chứng minh exact candidate `1e39d396d` giữ durable ACK qua restart,
final runtime closure, predecessor prompt revocation và durable timeline readback sau daemon restart; nó
không chứng minh exact candidate tự tạo một ACK mới. P2 qualification chứng minh ordered workflow và
durable readback trong dev daemon cô lập. Runtime lease gate đã có focused race/boundary tests và
paid-provider end-to-end release canary trên candidate branch, nhưng chưa có production qualification
hoặc multi-day evidence.
