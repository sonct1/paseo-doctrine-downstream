# Hệ thống skill của Paseo

Paseo có hai nhóm skill khác nhau: product workflow skills giúp user điều khiển Paseo, và Foundation
role skills được admit theo SLP role. Skill là instruction package cho một loại attention/workflow; nó
không phải role, provider, tool permission hoặc authority lease.

## Product workflow skills

Các package dưới [`skills/`](../skills/) phục vụ client hoặc coding agent đang điều khiển Paseo:

| Skill             | Dùng khi                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| `paseo`           | Quản lý workspace, agent, script, provider, schedule và heartbeat         |
| `paseo-advisor`   | Lấy một second opinion mà không giao ownership của task                   |
| `paseo-committee` | Dùng hai advisor cho hard planning/root-cause question                    |
| `paseo-handoff`   | Chuẩn bị briefing và launch receiving agent; không transfer SLP authority |
| `paseo-loop`      | Chạy bounded worker/verifier loop tới exit condition                      |

Đây là product capabilities. Việc một package được install hoặc visible không cho agent quyền tạo
workspace, launch agent, mutate repository hoặc accept engineering. Current role, exact lease và exposed
tool catalog vẫn quyết định action hợp lệ.

`paseo-handoff` là workflow skill cho context briefing và agent creation. Nó không tạo adjacent-Lead
handoff packet/state machine, không revoke predecessor, không activate successor Lead và không chuyển
Human/Lead authority.

## Foundation role skills

Immutable Foundation packages nằm dưới [`foundation/dist/skills`](../foundation/dist/skills/). Canonical
admission map là
[`role-bundles.json`](../foundation/dist/skills/role-bundles.json):

| Role       | Active                                                                    | Explicit-only  | Packaged-disabled |
| ---------- | ------------------------------------------------------------------------- | -------------- | ----------------- |
| Lead       | —                                                                         | `repo-refresh` | `ultra-review`    |
| Peer       | `frontend-design`                                                         | —              | —                 |
| Supervisor | `paseo-supervisor`, `architecture-premise-audit`, `test-proof-debt-audit` | —              | —                 |

Ý nghĩa admission:

- `active`: role có thể dùng khi task khớp trigger và lease;
- `explicit-only`: chỉ dùng khi Human gọi exact skill;
- `packaged-disabled`: bytes được ship để provenance/review nhưng không eligible ở runtime;
- package không thuộc bundle của role phải bị hide hoặc disable cho role đó.

`ultra-review` chưa được admit chỉ vì file tồn tại. Nó cần một Foundation-authored adaptation loại bỏ
native subagent/provider/path hard-code và có complete receive/verification path trước khi xin admission.

## Tại sao bundle theo role

Skill topology đi theo attention:

- Lead giữ integration attention, nên broad cleanup chỉ được mở bằng explicit Human intent.
- Peer giữ bounded implementation attention, nên `frontend-design` chỉ xuất hiện cho rendered UI work.
- Supervisor giữ process và proof attention, nên có causal supervision và hai audit lens read-only.

Expose mọi package cho mọi role tạo skill pollution: agent dễ trượt từ task sang orchestration,
architecture audit hoặc repository-wide cleanup mà assignment không yêu cầu.

## Trigger không cấp authority

Một skill chỉ được chạy khi cả ba điều kiện đều đúng:

1. package được admit cho current role;
2. user request hoặc task semantics khớp trigger của skill;
3. current lease cho phép các read, write, delegation hoặc external effect mà workflow cần.

Nếu skill yêu cầu action ngoài lease, dừng ở boundary và xin authority. Runtime `full-access`, skill
visibility hoặc lời gọi `$skill-name` không tự mở rộng project scope. Repository instruction và current
Human instruction có thể thu hẹp skill thêm.

## Progressive disclosure

Agent đọc toàn bộ `SKILL.md` sau khi chọn skill. Reference hoặc catalog lớn chỉ được load khi routing
instruction của skill yêu cầu. Ví dụ:

- `paseo-supervisor` dùng ordinary anti-pattern guards trước; chỉ mở broad structural catalog khi có
  reproduced workaround, architecture fog hoặc avoidable tax;
- `test-proof-debt-audit` bắt đầu từ một named behavioral claim và cited proof, không biến test yếu thành
  repository-wide audit;
- `architecture-premise-audit` chỉ dùng khi Human explicit yêu cầu broad premise audit;
- `repo-refresh` không bao giờ được implicit invoke.

Progressive disclosure giảm context pollution nhưng không cho phép đọc một phần `SKILL.md` rồi đoán phần
còn lại.

## Projection vào provider

Role bundle là canonical admission source; provider adapter chỉ là transport:

- Codex nhận exact `skills.config` với Foundation package ngoài bundle bị disable;
- Codex hiện có executable role-bundle projection; các provider khác chưa được claim role-visible skill isolation cho tới khi có adapter và fresh canary tương ứng;
- global package link hoặc user-global install không được biến thành eligibility cho non-owning role.

Nếu `role-bundles.json` missing, invalid hoặc trỏ tới package không tồn tại, projection phải fail closed và
không enable Foundation skill. Static file presence không chứng minh skill visible đúng role; release gate
cần fresh role-visible canary.

## Thêm hoặc đổi Foundation skill

Không sửa [`foundation/dist`](../foundation/README.md) trực tiếp. Thực hiện thay đổi trong canonical
Foundation repository, rồi:

1. xác định provenance: `DEMONTHORN_EXACT`, `FOUNDATION_DERIVATIVE` hoặc `FOUNDATION_AUTHORED`;
2. viết narrow trigger và explicit non-trigger;
3. chọn role owner cùng admission state;
4. xác minh package không cấp authority hoặc native delegation ngoài Paseo;
5. cập nhật `skills/role-bundles.json` tại Foundation source;
6. tag một clean Foundation commit và import bằng `scripts/import-foundation.mjs`;
7. kiểm manifest/checksum, provider projection và fresh role-visible canary.

Exact Demonthorn package giữ exact bytes. Derivative phải ghi rõ thay đổi và lineage. Product workflow
skill dưới root [`skills/`](../skills/) có lifecycle riêng và không được thêm vào Foundation role bundle
chỉ vì tên hoặc chức năng gần nhau.

## Checklist sử dụng

- Xác nhận current role và exact lease.
- Chọn một skill nhỏ nhất khớp task; không load skill theo curiosity.
- Đọc full `SKILL.md` và required references trước action.
- Giữ write/delegation/external effects trong assignment boundary.
- Report skill-caused pause hoặc material judgment trong manual handback.
- Không claim admission, activation hoặc qualification chỉ từ package presence.
