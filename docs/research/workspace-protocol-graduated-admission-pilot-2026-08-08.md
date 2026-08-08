# Workspace Protocol graduated admission — bounded pilot

Trạng thái: `LOCAL BEHAVIORAL PILOT`; daemon activation readback pass; role runtime canary và production
acceptance chưa được qualify.

## Câu hỏi

Một root protocol mặc định bắt buộc có thể giữ fail-closed cho material work nhưng vẫn cho phép exact
Human-authorized bootstrap/read-only/recovery mà không biến exception thành bypass tổng quát hay không?

## Thiết kế pilot

Pilot chạy trực tiếp qua daemon-owned role materialization và agent creation, không dùng paid provider,
không restart daemon và không giả lập outcome nhiều ngày. Ba counterfactual cases:

1. root protocol thiếu + `mutating` assignment: phải reject trước provider launch và state mutation;
2. root protocol thiếu + Human `read-only`, exact cwd scope, future expiry: phải admit và persist
   `no-write` receipt;
3. root protocol invalid + cùng Human exception: vẫn phải reject trước provider launch/state mutation.

Các falsification probes bổ sung: thiếu assignment, role/disposition mismatch, read-only/delegation có
write, mutating không có write, Peer nhận delegation/bootstrap/recovery, Supervisor nhận broad
mutating/delegation, agent-issued exception, exception hết hạn và scope khác cwd.

## Kết quả

- Case 1: `workspace_protocol_admission_required: missing`; provider create count `0`, agent state `null`.
- Case 2: create thành công; protocol receipt `missing`, mutation receipt `no-write`, provider create
  count `1`.
- Case 3: `workspace_protocol_admission_required: invalid`; provider create count `0`, agent state
  `null`.
- Contract probes đều pass; bootstrap bounded write được giới hạn vào exact
  `<cwd>/WORKSPACE_PROTOCOL.md` trong WebUI builder.

Focused evidence:

```text
npx vitest run packages/server/src/server/agent/assignment-contract.test.ts \
  packages/server/src/server/agent/agent-manager.test.ts --bail=1
2 files passed; 164 tests passed
```

## Diễn giải và giới hạn

Pilot chứng minh admission ordering, immutable boundary receipt và no-partial-mutation cho ba local
cases trên. Nó chưa chứng minh protocol làm quyết định tốt hơn, giảm false block trong repository thật,
giữ authority sau multi-day compact/resume, hay UX đủ rõ cho Human. Các claim đó giữ `UNKNOWN` cho tới
khi có role-canary daemon inspect readback và pilot thật với decision-changing counterfactual evidence.

## P4 activation readback

Sau `build:server`, fresh pre-restart readback xác nhận mọi agent đều `closed` và mọi configured workspace
script đều `stopped`. Main daemon được restart từ đúng candidate worktree, giữ home
`/Users/iznogoud/.paseo`, listen `127.0.0.1:6767` và relay disabled. Post-restart readback:

- `serverId=connectedServerId=srv_LIHKUsQGG3rt`;
- supervisor PID `79231`, worker PID `79232`;
- `localDaemon=running`, `connectedDaemon=reachable`;
- `cliVersion=daemonVersion=0.3.0-beta.1.paseo.1`;
- process cwd là exact `workspace-protocol-graduated-admission` worktree.

Readback này qualify activation identity của candidate bytes, không qualify provider-native durable
instruction, assignment persistence qua resume hoặc paid-provider behavior.

## Gate tiếp theo

Chỉ promote khi release candidate có: fresh daemon activation readback; một valid-protocol material
create; một missing-protocol Human bootstrap; receipt inspect sau resume; và record false-block,
exception-use, correction/handback outcome. Không dùng test count hay notification làm acceptance.
