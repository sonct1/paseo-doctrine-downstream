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
đổi role binding hoặc chuyển write lease ở revision được pilot lúc đó. Sau daemon restart, runtime
projection là `closed`, phù hợp với durable record chưa được initialize lại và không phải handoff
lifecycle mutation.

Hai activation finding có giá trị:

- agent-scoped tools fail closed khi isolated config chưa bật `daemon.mcp.injectIntoAgents`;
- live status ban đầu bỏ sót persisted handoff metadata; merge projection được sửa và restart readback
  xác nhận packet cùng receipts hiện diện.

## P0 callable-surface canary trên integrated daemon

Canary tiếp theo dùng main daemon đang chạy candidate tích hợp, role-bound Codex Lead
`2e0ba1a1-db16-4026-b65a-372f88c755f3` với assignment `read-only`. Human-facing CLI persist signal
`edadc1fe-9563-4b39-aff1-a98d21f62c5b` ở trạng thái `pending` rồi daemon giao signal tại idle
boundary.

Lead đã gọi native tool `resolve_agent_signal` với resolution `acknowledged`. Runtime readback trả đúng
`targetAgentId`, workspace `wks_35c288102246b035`, status `acknowledged` và `resolvedAt`
`2026-08-08T10:00:00.809Z`. Canary không dùng shell fallback, không sửa file, không delegate và không
thực hiện handoff transition. Agent được archive sau readback.

Canary này sửa một lỗi trong phương pháp qualification trước đó: hỏi model tự liệt kê tool đang thấy,
đặc biệt khi prompt cấm tool call, không chứng minh callable surface có hay không. Provider có thể defer
tool discovery dù MCP server đã mount. Từ đây, qualification MCP phải có cả hai bằng chứng:

- timeline ghi nhận invocation của exact native tool;
- daemon readback xác nhận exact durable state mà invocation tạo hoặc thay đổi.

Self-report kiểu “có tool” hoặc “không thấy tool”, `tools/list` riêng lẻ và MCP startup status chỉ là
diagnostic evidence; không thay thế end-to-end callable proof.

## Paid-provider final-release canary

Main daemon chạy exact candidate `83f35e8b6d41dd2afb953161f6c801f29014c9b4` từ integration
worktree, PID worker `25011`, listen `127.0.0.1:6767`, relay disabled. Disposable workspace
`wks_86b4dbef90e91198` giữ repository clean và valid protocol digest
`50d7b56a713d27f35581e4d3d905a9bdccf462e88d7fdd87e07c222b54b3e85a`.

Paid `codex/gpt-5.4` predecessor `881dbefc-911e-41c3-a3c2-90b908426ae7` prepare handoff
`acb2a367-4cbe-4c2f-8051-20343126b3a6` cho successor
`9a70ac41-7fed-412b-9f5b-de717ba39b7e`. Human-facing unscoped native tool authorize exact
successor; successor independently verify packet/repository rồi gọi native
`successor_acknowledged`; Human-facing tool chỉ ghi `predecessor_released` sau ACK.

Final durable readback có ba ordered receipts, `currentWriteOwnerAgentId` đổi sang exact successor.
Post-release CLI prompt vào predecessor fail closed:

```text
agent_write_lease_released: 881dbefc-911e-41c3-a3c2-90b908426ae7;
successor=9a70ac41-7fed-412b-9f5b-de717ba39b7e;
handoff=acb2a367-4cbe-4c2f-8051-20343126b3a6
```

Successor vẫn nhận và hoàn tất post-release prompt; Git vẫn clean. Workspace và cả hai agents được
archive sau readback. Canary qualify paid-provider final release, owner transfer và predecessor prompt
revocation trên candidate bytes; nó không qualify production release hoặc multi-day effect.

## Doctrine closure sau canary

Ba policy decision được Human chốt sau canary:

- explicit Human authorize/release không có elapsed-time cooling window; ordered receipts và safe idle
  boundary là các gate;
- automated signal đơn là advisory, không tự trigger authority change. Repeated failure cần ba lần liên
  tiếp; context/compaction có thể tạo một attention sớm nhưng replacement/handoff chỉ được đề xuất khi có
  repeated hoặc independently corroborated evidence;
- final release đóng predecessor runtime nhưng giữ durable unarchived record. Không auto-detach hoặc
  auto-archive, và released agent ID không được reactivate làm Lead; lần quay lại dùng fresh role-bound
  identity.

Candidate implementation fail closed: runtime closure xảy ra trước khi final transition được persist;
nếu closure lỗi thì packet giữ `successor_acknowledged` và current Owner không đổi. Follow-up adversarial
review yêu cầu join in-flight close, sticky failure tới daemon restart, bounded close wait để giải phóng
successor lock, và durable timeline read không resume released runtime; candidate đã implement các gate
này. Follow-up durability review thay JSONL append bằng atomic per-row files và bắt final release
drain/retry exact predecessor timeline writes; unresolved repair chặn transfer. Guarantee này không
backfill timeline cho candidate `predecessor_released` records có trước lúc file-backed store activate và
vẫn cần activation canary.

## Residual unknowns

- Chưa có multi-day evidence về continuity improvement.
- Candidate P0 đã có paid-provider callable proof trên integrated daemon, nhưng chưa release-activated
  hoặc production-qualified.
- Candidate P2 đã qualified trên isolated runtime, chưa release-activated hoặc production-qualified.
- Candidate enforce final release ở core daemon dispatch boundary, bao gồm existing-agent schedule
  và permission follow-up; release bị reject khi predecessor còn in-flight. Released identity không thể
  được tái authorize làm successor; successor được revalidate dưới dual-identity stable locks ngay tại
  final release. Paid-provider end-to-end release canary đã pass trên integrated daemon, chưa
  production-qualified.
- Runtime closure và durable predecessor retention trên exact post-doctrine candidate cần một fresh
  activation canary; paid-provider canary phía trên chạy revision trước thay đổi closure này.
