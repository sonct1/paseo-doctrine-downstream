# Foundation first run

Luồng này dành cho người lần đầu dùng Paseo Foundation downstream. Nó tạo một workspace local có
authority receipt đầy đủ trước khi giao material work. Guided Hub starter của upstream v0.5.0 chưa nằm
trong luồng này vì Hub chưa chuyển được role, assignment, Workspace Protocol admission và exact output
grants tới daemon.

## 1. Xác nhận runtime đang active

Chạy readback trước khi tạo agent:

```bash
paseo daemon status --json
paseo-foundation inspect --json
paseo-foundation doctor --project /absolute/path/to/repository
```

Tách các kết quả: installed bytes, live daemon, Foundation distribution và project readiness. Một gate
`UNKNOWN` không phải `PASS`; sửa đúng gate hoặc giữ task no-write cho tới khi có evidence.

## 2. Tạo project và workspace

Trong WebUI, thêm exact repository root thành Project rồi mở workspace của project đó. Project và
workspace chọn nơi agent chạy; chúng không cấp role hoặc mutation authority.

Mở **Project Settings → Workspace Protocol**:

- nếu file absent, preview baseline rồi bootstrap `WORKSPACE_PROTOCOL.md` vào exact repository root;
- nếu file invalid, dùng correction path và review diff trước khi save;
- nếu file valid, đọc owner, protected areas, issue-tracker clause và local tactics delta.

Absence chỉ cho phép assignment `no-write` không có external effect. Delegation, mutation và protected
work fail closed cho tới khi protocol được admit hoặc Human cấp exact bounded bootstrap exception. File
invalid luôn fail closed. Schema version không phải gate.

## 3. Phân biệt Agent Profile và Role Profile

Mở **Settings → Host → Agent profiles** để cấu hình provider/model/mode/thinking shortlist. Agent Profile
chỉ là routing metadata; nó không cấp role, lease hoặc acceptance authority.

Role Profile (`Lead`, `Peer`, `Supervisor`) giữ standing invariants của Foundation. Assignment của từng
agent mới giữ objective, effect class, write scope, evidence, handback và stop condition. Không dùng tên
profile hoặc initial prompt để giả lập role.

## 4. Tạo Lead đầu tiên

Trong workspace, chọn role **Lead**, chọn exact provider/model đã discover, rồi điền assignment:

```text
Objective: <observable outcome>
Authority: <exact write owner và scope | no-write; external effects>
Evidence: <behavior/checks phải quan sát>
Handback/stop: <stable artifact, completion hoặc blocker>
```

Sau create, đọc authoritative receipt:

```bash
paseo agent inspect <lead-agent-id> --json
```

Xác nhận `Role`, `ProviderId`, `Model`, `BindingDigest`, `ProtocolStatus`, assignment receipt và
credential readiness. Agent tự nói mình là Lead không thay readback này.

Prompt first turn mẫu:

```text
mày làm Lead cho tao trong đúng workspace này. Đọc protocol trước, nhắc lại objective, authority,
stop condition và những decision tao vẫn giữ. Chưa đủ receipt thì dừng, đừng tự mở rộng scope.
```

## 5. Chỉ tạo Peer khi cần independent judgment

Lead dùng `list_profiles`, verify route hiện tại rồi gọi native `create_agent` với `role=peer`, exact
workspace và bounded assignment. Mỗi moving scope chỉ có một write Owner. Peer không đọc full protocol;
Lead chuyển đúng constraints liên quan và mandatory issue-tracker checkpoint.

Prompt assignment mẫu:

```text
review đúng scope tao giao, đừng đụng file ngoài scope. Mày không có acceptance authority; có premise
sai hoặc evidence thiếu thì REOPEN_REQUEST/BLOCKED và nói thẳng.
```

Receipt phải chứng minh Peer là direct child của exact Lead, role binding immutable, assignment digest
đúng và no-write mode được daemon pin khi assignment không cho mutation.

## 6. Dùng Supervisor như governance observer

Human tạo Supervisor trong assignment riêng. Mặc định là `observe + advise only`; Supervisor không quản
lý task thường ngày, direct Peer, implement product hoặc accept engineering.

Prompt mẫu:

```text
mày check giúp tao workspace này đang có gì bất thường, chỉ quan sát Lead-to-Peer flow thôi, chưa được
sửa gì. Tách evidence, suspected mechanism, impact và unknown; đề xuất correction nhỏ nhất cho tao.
```

Chỉ exact Human recovery/replacement lease mới mở bounded `STOP`, `FREEZE` hoặc Lead replacement flow.

## 7. Room và Council

Room là coordination channel. Tạo Room trong sidebar, post checkpoint, reply/mention agent và đọc
author receipt. Message không chuyển ownership hoặc acceptance.

Council là Lead-only decision workflow. Human yêu cầu exact Lead mở Council; daemon admit ba fresh Peer
seats `Scout`, `Architect`, `Reviewer`, giữ authored Room evidence và trả một Lead verdict. Seat không
spawn seat khác, generic Engineer không được giả làm Council seat, và trạng thái idle/completed không
thay literal seat report cùng receipt.

Prompt mẫu:

```text
mở council cho tao: Scout tìm evidence, Architect đề xuất, Reviewer phản biện. Mỗi seat post report vào
Room; cuối cùng mày trả verdict, dissent, unknown và native receipts. Chưa đủ seat evidence thì BLOCKED.
```

## 8. Handback và acceptance

Peer hand back candidate; Lead inspect exact current bytes và issue `ACCEPT`, `REOPEN`, `REJECT` hoặc
`UNKNOWN`. Test pass, notification hoặc lifecycle `completed` không tự là acceptance.

```text
Outcome: <complete | partial | blocked | reopen requested>
Snapshot/candidate: <Git identity hoặc exact bounded identity>
Changed/inspected scope: <paths>
Verification/skips: <personally observed>
Unknowns/risks/Human decisions: <material only>
Ownership/lease: <released | retained with reason>
```

## Hub starter status

`paseo hub login` vẫn dùng được cho manual Hub authority. Automatic guided continuation không được attach.
`paseo hub init` trả `HUB_FOUNDATION_ADMISSION_REQUIRED` trước daemon connection, workspace read/write
hoặc deploy. Reopen starter chỉ khi Hub và daemon negotiate revision-scoped assigner, role/assignment,
Workspace Protocol admission receipt, exact output grants và file-scoped writes.
