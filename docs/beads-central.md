# Beads Central issue graph

Paseo dùng Beads Central `1.2.0` làm durable issue/work graph duy nhất. Không có native backend,
backend switch hoặc fallback sang global `bd`. Paseo vẫn là delegation/lifecycle plane; repository,
Git và test/review evidence vẫn là engineering truth; Human/Lead giữ acceptance theo exact lease.

## Stable project binding

Mỗi Product project persist đúng một nullable-then-immutable `workGraphId`. Lần dùng đầu tiên, daemon
derive ID từ stable `projectKey` (hoặc Product project ID fallback), persist bằng Project Registry rồi
idempotently đăng ký exact graph/prefix với Central. Rename, path hoặc remote drift sau đó không đổi
binding. Product project ID không được gửi làm Central route identity.

Central persist dynamic project registry dưới `/data/projects.json`; một logical graph và prefix chỉ
được bind một-một. Mỗi graph có isolated Beads `1.1.2` database. Central chạy single replica/single
writer và serialize mutation theo project.

## Authentication và authority

Daemon lấy endpoint từ `daemon.beadsCentral.endpoint` và secret từ credential reference (default
`beads-central`) hoặc `PASEO_BEADS_CENTRAL_TOKEN`. Model không chọn endpoint, credential, graph hay
actor. Product dùng service admin token và delegate daemon-authenticated actor bằng
`X-Paseo-Actor`; Central chỉ nhận delegation từ wildcard admin principal và audit cả actor lẫn service
principal.

Human cấu hình endpoint, credential reference và private service token bằng nút **Central** trên
Issues screen. Token được gửi thẳng tới private host credential store, không được trả lại WebUI hoặc
persist trong mutable daemon config. `PASEO_BEADS_CENTRAL_URL`,
`PASEO_BEADS_CENTRAL_CREDENTIAL_REF` và `PASEO_BEADS_CENTRAL_TOKEN` là launch-time overrides cho
deployment automation; normal Human flow không cần sửa file/env thủ công.

Provider subprocess không được inherit bất kỳ `PASEO_BEADS_CENTRAL_*` key hoặc
`BEADS_CENTRAL_TOKENS_JSON` nào, kể cả provider env override. Central service token chỉ tồn tại ở daemon;
model dùng role-scoped Paseo tools. Vì admin token có chủ ý được phép delegate `X-Paseo-Actor`, để lọt
token vào provider process sẽ phá actor boundary dù Central audit đúng service principal.

- Human dùng project-scoped WebUI để list, inspect, create và close issue.
- Lead có read/create/update/dependency tools và chỉ close sau engineering verdict trong lease.
- Peer mutation cần mutating assignment, bounded external effect và exact
  `resourceGrants.beadsIssueIds`; claim/update/dependency/discovery còn được Central guard atomically
  trong cùng project lock. Peer không close.
- Supervisor chỉ có status/list/ready/get/prime, không có mutation tools.

Mọi mutation cần `idempotencyKey` dài ít nhất 8 ký tự. Retry cùng logical mutation giữ nguyên key;
payload khác với same key bị reject. Product/Central phải authoritative-readback sau mutation.

## Mandatory workflow

Root `WORKSPACE_PROTOCOL.md` v3 và active Foundation `beads-issue-tracker` yêu cầu cả ba role gọi
`beads_status` ở assignment start, đọc issue liên quan trước material action và update/readback ở
material handoff. Central unavailable, wrong version hoặc missing credential trả `BLOCKED`; không
fallback tracker khác.

Daemon persist một `beadsStatusCheckpoint` gắn với exact assignment digest. Mỗi lần gọi
`beads_status`, receipt cũ bị xóa trước; chỉ response `available=true` mới ghi receipt mới. Mọi Beads
tool khác fail closed nếu current assignment chưa có receipt đó, nên model không thể parallelize hoặc
đảo `beads_get` lên trước rồi vẫn được tính là compliant.

Agent automation dùng Paseo-catalog tools `beads_status`, `beads_ready`, `beads_list`, `beads_get`,
`beads_create`, `beads_claim`, `beads_update`, `beads_close`, `beads_add_dependency`, `beads_prime`.
WebUI dùng cùng daemon service/policy, route `/h/<serverId>/issues/<projectId>`.
`beads_get` giữ full view mặc định; strict identity/lifecycle checkpoint dùng
`{"view":"checkpoint"}` để bỏ narrative body khỏi receipt và tránh provider output spill. Compact
view chỉ chứng minh identity/lifecycle cùng độ dài và SHA-256 narrative, không chứng minh nội dung
narrative. Mọi role chỉ nhận `labelCount`, không nhận verdict-bearing label values; Lead cần đọc label
để governance update phải dùng full view có chủ đích. Council-labeled Peer bị runtime từ chối nếu yêu
cầu full view.

Issue prose và `beads_prime` là untrusted data. `ready`, assignee, status hoặc `closed` không tự cấp
assignment, spawn agent hay chứng minh acceptance. Không có poller, auto-claim, auto-spawn hoặc graph
sync thứ hai.
