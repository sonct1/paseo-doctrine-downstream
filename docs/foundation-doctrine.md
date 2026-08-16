# Doctrine của Paseo Foundation

Paseo Foundation bổ sung một operating model cho việc điều phối coding agent. Paseo vẫn sở hữu
workspace, agent lifecycle, provider transport và client surfaces; Foundation định nghĩa authority,
role, ownership, evidence và cách topology thay đổi theo risk.

Canonical doctrine được ship dưới [`foundation/dist`](../foundation/README.md). File này giải thích
doctrine theo góc nhìn Paseo product; nó không thay thế
[Demonthorn Agent Orchestration Deep Dive](../foundation/dist/references/demonthorn-agent-orchestration-deep-dive.md),
[Canonical Role Contracts](../foundation/dist/docs/ROLE_CONTRACTS.md) hoặc current Human instruction.

## Maturity boundary

Doctrine, candidate implementation và qualified product capability là ba trạng thái riêng:

- doctrine dưới `foundation/dist` định nghĩa intended authority và operating behavior;
- manual coordination-signal slice là experimental product code, chưa phải standing workflow default
  hoặc runtime-qualified capability;
- automatic native-attention policy không được implement hoặc start;
- stop condition và handback hiện là manual assignment/handback contracts;
- adjacent-Lead handoff và Supervisor recovery/replacement vẫn là Human-driven workflow, chưa có automated
  state machine.

Focused tests hoặc code presence chỉ chứng minh candidate bytes ở boundary được test. Chúng không chứng
minh daemon activation, end-to-end SLP behavior hoặc product completion.

## Thứ tự áp dụng

Khi hai nguồn mâu thuẫn material, áp dụng theo thứ tự:

1. current Human instruction và exact lease;
2. Demonthorn Agent Orchestration Deep Dive;
3. Canonical Role Contracts cùng repository `WORKSPACE_PROTOCOL.md`;
4. current repository bytes và reproduced evidence;
5. historical material dùng cho audit hoặc teaching.

Provider, model, runtime mode, agent status, Memory hoặc historical plan không tự cấp authority.

## Những gì Foundation thêm vào Paseo

### Một control plane

Paseo là delegation và lifecycle plane duy nhất. Foundation roles không được mở thêm Codex-native,
Claude-native hoặc provider-native agent tree. Một session có thể có `full-access`, nhưng capability đó
không cấp write lease, ownership, external effect, recovery, replacement hoặc acceptance authority.
Ngược lại, assignment có mutation boundary `no-write` phải được daemon pin vào provider-enforced
no-write mode; không có mode đã qualify thì launch fail closed. Agent không được đổi mode hoặc approve
permission escalation để thoát boundary này.

### Ba instruction layer

Mỗi session role-bound được compose từ ba layer có owner khác nhau:

| Layer                            | Owner                          | Nội dung                                                         |
| -------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Standing role                    | Foundation                     | Identity, universal authority boundary, anti-pattern guards      |
| Optional `WORKSPACE_PROTOCOL.md` | Project repository             | Material repo-specific tactics cần sống qua nhiều task           |
| Assignment                       | Human hoặc Lead đúng authority | Objective, disposition, lease, scope, evidence, handback và stop |

Không có material repository delta thì không cần tạo `WORKSPACE_PROTOCOL.md`. `AGENTS.md` tiếp tục sở
hữu engineering conventions; assignment không copy cả organization manual.

### SLP thay cho một đàn agent phẳng

Foundation có ba role native:

- `Supervisor` bảo vệ orchestration quality và continuity cho Human. Supervisor không phải super-Lead.
- `Lead` giữ project outcome, topology, integration, cross-scope decision và engineering acceptance.
- `Peer` cung cấp independent judgment trong một bounded assignment và không điều phối agent khác.

Human giữ những decision ngoài Lead lease và là authority duy nhất chọn hoặc authorize Supervisor. Xem
[SLP usage guidance](slp-usage.md) để vận hành topology này.

### Một writer cho mỗi moving scope

Mỗi moving hoặc coupled scope có đúng một write Owner. Reviewer nhận stable candidate, không review một
target vẫn đang đổi. Lead không implement rồi tự accept một material change. Parallelism chỉ có ích khi
scope thật sự độc lập và ownership không chồng nhau.

### Independent judgment

Peer nhận neutral outcome brief, không nhận một solution đã pre-solve để xác nhận. File list và plan là
provisional trừ khi chúng là exact ownership boundary. Peer được yêu cầu reopen, báo dependency, block
hoặc đề nghị council khi evidence làm thay đổi quyết định.

### Evidence khác status và acceptance

Current bytes, stable Git identity, focused checks và reproduced behavior là evidence. Notification,
silence, lifecycle `completed`, model confidence hoặc một test pass đơn lẻ chỉ là signal. Peer handback
wake Lead; Lead hoặc Human đúng boundary mới issue verdict.

### Topology nhỏ nhất theo risk

Lead làm trực tiếp exact tiny task khi applicable binding cho phép và việc transfer không thêm
independent judgment. Bounded material work dùng một Peer Owner. Reviewer chỉ được thêm khi failure risk,
irreversibility hoặc independent falsification đáng giá. Supervisor chỉ xuất hiện khi Human cần
governance observation, continuity hoặc bounded recovery.

Council, committee và nhiều reviewer không phải default. Thêm node phải trả lời được node đó giảm risk
nào mà topology nhỏ hơn không giảm được.

### Sparse, event-driven supervision

Doctrine yêu cầu event-driven attention thay cho polling. Current notification surfaces có thể đánh thức
authority holder; durable manual coordination signal là một experimental slice. Signal chỉ mang advisory
evidence và không tự quyết safe checkpoint, handoff, detach hoặc lifecycle action. Automatic native
continuity attention chưa được implement. Xem
[agent lifecycle](agent-lifecycle.md#experimental-coordination-signals--manual-only).

### Role và transport tách rời

Paseo compose `RoleDefinition + Provider + Workspace Protocol + Assignment` thành immutable launch
contract. Provider giữ transport, credential, endpoint, model và runtime capability. Role giữ authority
contract. Một model xuất hiện trong catalog không chứng minh provider bind được role.

Role instruction đi qua provider-native durable channel và giữ nguyên khi resume. Client không được gửi
hoặc override materialized role bytes. Incompatible provider fail closed; không fallback sang initial
prompt hoặc provider khác. Chi tiết nằm trong
[Native Role Binding ADR](native-role-binding.md).

### Agent launch preset chỉ là route shortlist

Agent profile lưu provider, model, mode, thinking, feature values và routing notes do Human cấu hình.
Nó không chứa standing instruction, Workspace Protocol, assignment hoặc authority. Human có thể chọn
preset khi launch Lead/Supervisor; Lead được đọc `list_profiles` để chọn candidate cho Peer rồi vẫn phải
kiểm current provider/model/features trước `create_agent`. Peer và Supervisor không nhận tool này.

Role-bound session chỉ áp preset ở create-time. Route đã bind cần thay đổi thì respawn qua role-first
flow để có LaunchContract mới; không apply preset lên live role-bound agent. `full-access`, fast mode hay
notes trong preset không mở rộng mutation, delegation, plugin hoặc acceptance lease.

### Skill admission theo attention

Foundation skill không được expose đồng đều cho mọi role. Role bundle chỉ admit package phù hợp với
attention và authority của role; package presence không đồng nghĩa role eligibility. Skill hỗ trợ cách
làm việc, không cấp scope hoặc authority. Xem [skill system](skill-system.md).

### Distribution và project truth tách lifecycle

Foundation distribution là immutable và Paseo product/runtime bám upstream riêng. Control Workspace là
deferred hypothesis, không phải prerequisite; nếu một bounded pilot explicit opt in thì Home của nó là
mutable và user-owned. Nó có thể giữ portfolio-level binding, project index và redacted Supervisor
learning, nhưng project repository vẫn sở hữu protocol, product truth và engineering acceptance. Xem
[Paseo Foundation product](foundation-product.md).

## Anti-pattern cần chặn sớm

- pre-solve rồi thuê Peer xác nhận;
- hai writer cùng sửa một coupled scope;
- self-review hoặc self-accept material work;
- dùng test-shaped proxy thay cho behavior cần chứng minh;
- coi status hoặc notification là acceptance;
- poll agent thay cho native finish/attention event;
- thêm reviewer, council hoặc protocol chỉ để đủ ceremony;
- cho Supervisor direct Peer hoặc quyết định product ngoài recovery lease;
- coi provider/model/mode là authority;
- expose mọi skill cho mọi role.

Khi chưa đủ evidence, giữ kết luận là `UNKNOWN`, `BLOCKED` hoặc `REOPEN`; không lấp chỗ trống bằng
inference thuận tiện.

## Reading map

- [Demonthorn Deep Dive](../foundation/dist/references/demonthorn-agent-orchestration-deep-dive.md):
  doctrine, topology và anti-pattern đầy đủ.
- [Canonical Role Contracts](../foundation/dist/docs/ROLE_CONTRACTS.md): normative boundary của SLP.
- [Assignment và Handback](../foundation/dist/docs/ASSIGNMENT_AND_HANDBACK.md): packet tối thiểu cho một
  task.
- [Role Instruction Binding](../foundation/dist/docs/ROLE_INSTRUCTION_BINDING.md): profile, protocol,
  provider-native transport và skill projection.
- [Native Role Binding ADR](native-role-binding.md): cách doctrine được hiện thực trong Paseo daemon,
  protocol, CLI và WebUI.
- [Paseo Foundation product](foundation-product.md): distribution, installer, Control Workspace và
  release gates.
