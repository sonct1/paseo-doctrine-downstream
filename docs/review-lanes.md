# Triple-lane review và private `review` specialization

Trạng thái: candidate implementation; static/focused tests có, live end-to-end triple-review canary chưa có.

## Topology

Lead chỉ mở triple-lane review cho một material review question trên stable candidate:

```text
Lead
  ├─ semantic reviewer: GPT-5.6 Sol high
  ├─ semantic reviewer: Claude Opus 5 xhigh
  └─ private review specialization: any SLP-supported Peer route + exhaustive coverage
```

Hai semantic reviewer là independent Peer seats. `review` vẫn có authority role `peer`, nhưng nhận
private execution profile cho deterministic coverage. Nó không phải authority tier, general reviewer thứ
ba hoặc phiếu biểu quyết.

Lead freeze cùng một target identity và neutral review contract trước khi launch. Không lane nào được
nhận finding, suspected defect hoặc conclusion của lane khác trước handback đầu tiên. Lead nhận ba sealed
artifact, confront material contradiction bằng disproof/reproduction trên cùng target rồi issue verdict.
Council chỉ được mở khi consequential conflict còn unresolved hoặc Human/project owner yêu cầu.

## Private profile boundary

Chỉ role-bound Lead thấy field `executionProfile` trong agent-scoped `create_agent`. Lead tạo private coverage seat bằng:

```text
role=peer
executionProfile=review
provider/model=<SLP-supported Peer provider>/<assigned model>
mode=<provider-native assigned mode>
thinking=<assigned effort>
```

Daemon reject non-Lead caller, non-Peer authority hoặc provider mà SLP không support cho role-bound Peer
trước state mutation. Generic Peer role bytes, Peer skill bundle và public role/launch receipts không chứa
profile ID. Exact profile receipt chỉ được trả cho calling Lead; persisted binding giữ exact composed
instruction bytes để resume không resolve lại profile mới. Specialization không pin provider/model/effort
và không có provider allowlist riêng; những giá trị đó thuộc immutable assignment launch contract.

Đây là attention/discovery boundary, không phải confidentiality boundary. Một Peer có filesystem
full-access và assignment cho phép đọc Paseo source hoặc private daemon storage vẫn có thể tìm thấy
implementation bytes. Paseo cũng chưa mediate mọi provider-native shell command theo executable, nên
không thể claim OS-level denial đối với một binary đã nằm trên shared host PATH. Hard capability denial
cần process/user/container isolation hoặc daemon-owned private tool execution; không dùng profile hiding
như một security boundary.

## Coverage contract

`review` sở hữu private deterministic file-selection và rule-resolution workflow; assigned review model
tự inspect diff, full file, caller, test, config và generated boundary. Mọi reviewable `(path, status)`
phải được disposition thành reviewed hoặc skipped-with-reason; excluded surface và applied rule groups
vẫn được account. Selected surface là coverage floor, không phải context ceiling.

Artifact trả Lead gồm target identity, reviewed/skipped/excluded files, applied rules, coverage rate và
evidence-backed findings. Selector output không phải finding hoặc acceptance verdict; ordinary Lead
handback không expose private executable, command, session metadata hoặc raw selector output.

## Provider inheritance

Canonical Foundation source candidate `profiles/native/execution-specializations.json` định nghĩa `review`
như provider-neutral overlay trên standing Peer role. Foundation adapt instruction blocks từ review
behavior thầy Demon cung cấp; full TOML của nguồn đó không phải runtime profile để copy nguyên. Daemon
compose overlay vào immutable `RoleBinding`. Review không có provider matrix riêng: bất kỳ route nào
daemon hiện admit cho role-bound Peer đều nhận cùng composed bytes qua existing adapter. Built-in channels
hiện gồm Codex, Claude, Pi và OMP; Cursor/Antigravity dùng exact native driver đã được SLP admit. Khi SLP
thêm hoặc bỏ Peer provider support, review tự kế thừa thay đổi đó mà không sửa profile. `foundationSkills=none`
là specialization policy. Imported immutable Foundation dist hiện tại predates canonical artifact, nên
Product tạm dùng một digest-pinned compatibility fallback ngoài provider adapters. Fallback không phải
extension point, không nhận profile mới và phải bị xóa ở clean Foundation import kế tiếp có registry.

Private coverage dependency được exact seat tự kiểm tra sau khi Lead chọn route. Missing hoặc incompatible
dependency tạo generic coverage blocker cho assignment đó, không biến thành provider qualification gate.
Implementation identity và invocation contract chỉ nằm trong private specialization bytes; Supervisor có
thể inspect chúng dưới exact oversight mandate nhưng không sở hữu execution duty hoặc profile launch route.

Release evidence cần ít nhất:

- exact Lead-only schema/readback canary và ordinary-Peer absence canary;
- stable-candidate drift canary;
- rename, delete, binary, generated, staged-delete-plus-untracked-recreate accounting;
- three sealed handbacks với một planted disagreement và Lead convergence;
- current private dependency readback, và một end-to-end canary chứng minh selected SLP-supported Peer
  route nhận review overlay, internal coverage access và redacted handback contract.
