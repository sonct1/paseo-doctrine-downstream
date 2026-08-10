# Native Beads issue graph

Paseo dùng Beads làm issue engine cục bộ cho work state bền vững. Paseo vẫn là plane duy nhất cho
delegation, lifecycle và acceptance; Beads không spawn agent, không route assignment và không tự suy
ra verdict.

## Identity và storage

Một graph thuộc về một daemon-local `projectId`, không thuộc về workspace hay worktree. Vì vậy mọi
workspace của cùng project nhìn thấy cùng issue graph, còn hai project khác nhau không dùng chung
state dù chúng có cùng đường dẫn hoặc issue title.

Daemon lưu graph dưới `$PASEO_HOME/beads/projects/<sha256(projectId)>`. Mỗi graph chạy với `HOME`,
`BEADS_DIR`, actor và config directory riêng. Adapter gọi binary bằng argument vector, tắt daemon mode
và telemetry của Beads, serialize mutation theo project, rồi validate JSON output trước khi trả về
Paseo.

Mutation bắt buộc có `idempotencyKey`. Receipt được scope theo actor, operation và key; cùng request
được replay, còn cùng key với payload khác bị từ chối.

`status`, list trên project mới và các read bị từ chối không khởi tạo durable graph. Mutation đầu tiên
mới tạo project-private Beads state. Runtime verification dùng temporary directory ngoài
`$PASEO_HOME` rồi xóa ngay.

## Runtime

Release macOS bundle đúng `bd v1.1.2` cùng license và SHA-256 đã pin. Binary nằm cạnh Node runtime
trong artifact và không được thêm vào user `PATH`. Source checkout không fallback sang global `bd`;
dev hoặc E2E phải truyền exact binary qua `PASEO_BEADS_BINARY`.

## Authority

- Human dùng project-scoped WebUI để list, inspect, create và close issue.
- Lead có toàn bộ native Beads tools cho project của assignment hiện tại.
- Peer có thể đọc. Mutation chỉ dùng được với exact issue ID trong
  `assignment.resourceGrants.beadsIssueIds`; claim phải dùng granted ID, update/dependency còn đòi
  issue đang assigned cho chính actor, và discovery phải có `discoveredFrom` trỏ tới granted,
  self-assigned source issue. Peer không close issue.
- Supervisor chỉ đọc.

Daemon derive `projectId`, actor và role từ session/assignment hiện tại cho agent tools. Caller không
được tự chọn project hoặc actor. WebUI RPC chỉ chấp nhận project đang active trong Project Registry.

`closed` là receipt của work state, không phải engineering acceptance. Lead hoặc Human vẫn phải đọc
evidence và đưa verdict theo role contract.

## Surfaces

- WebUI: project menu → **Open issues**; route `/h/<serverId>/issues/<projectId>`.
- Agent automation: Paseo-catalog tools `beads_status`, `beads_ready`, `beads_list`, `beads_get`,
  `beads_create`, `beads_claim`, `beads_update`, `beads_close`, `beads_add_dependency`, `beads_prime`.
- Role skill: `skills/beads-issue-tracker/` chỉ hướng agent dùng native tools; skill không cài Beads và
  không shell ra `bd`.

Tool names và authority contract không phụ thuộc provider, nhưng callable delivery vẫn cần provider route
có Paseo MCP/tool channel. Role binding hoặc skill projection thành công không tự chứng minh tools đã hiện
diện. Nếu route không support channel này, agent phải báo `BLOCKED`/`UNKNOWN`; không shell qua Human CLI,
global `bd` hoặc tự nhận Human identity làm fallback. Human WebUI vẫn dùng native project RPC độc lập với
provider capability đó.

Không có poller, auto-claim, auto-spawn hoặc đồng bộ `.beads` vào repository. Những behavior đó cần
evidence riêng trước khi trở thành product policy.
