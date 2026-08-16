# Paseo Foundation product

Paseo Foundation được ship cùng repository này nhưng giữ ba lifecycle riêng:

- `foundation/dist` là doctrine và role asset immutable, được import từ exact tagged Foundation commit.
- Paseo daemon, app và protocol là runtime downstream bám upstream Paseo.
- `control-workspace/template` là seed experimental cho Control Workspace Home mutable, user-owned;
  Foundation install mặc định không tạo home này.

Dev pilot phải theo exact tag, acceptance gate và rollback trong
[controlled dev-pilot runbook](dev-pilot.md). Downstream này không publish package dưới upstream
`@getpaseo` scope.

Không sửa `foundation/dist` trực tiếp. Thay đổi doctrine ở repository Foundation, tag một commit sạch,
rồi chạy `scripts/import-foundation.mjs`. `foundation/manifest.json` khóa SHA-256 từng file;
`foundation/sources.lock.json` khóa Foundation commit và Paseo upstream commit.

## Cài trên macOS

Cài CLI từ exact downstream checkout trên macOS với Node.js 20 trở lên:

```bash
npm run build --workspace=@getpaseo/foundation-cli
npm install -g ./packages/foundation-cli
```

Không dùng `npm install -g @getpaseo/foundation-cli` từ registry để activate downstream: command đó có
thể lấy upstream package khác bytes đang review.

Inspect chỉ đọc state hiện tại và không trả credential value:

```bash
paseo-foundation inspect
paseo-foundation inspect --json
```

Tạo exact plan trước khi mutate:

```bash
paseo-foundation plan \
  --mode clean-empty \
  --output "$HOME/.paseo-foundation/install-plan.json"
paseo-foundation install \
  --plan "$HOME/.paseo-foundation/install-plan.json"
```

Command trên chỉ cài immutable Foundation distribution và owned runtime links. Chỉ khi một bounded
Control Workspace pilot đã qua evidence gate riêng mới thêm `--with-control-workspace` lúc tạo plan:

```bash
paseo-foundation plan \
  --mode clean-empty \
  --with-control-workspace \
  --output "$HOME/.paseo-foundation/install-plan.json"
```

Chọn mode theo state đã inspect:

- `clean-empty`: máy chưa có Foundation hoặc target link; Control Workspace chỉ tham gia classification
  khi plan có explicit opt-in.
- `coexist`: giữ config/tool hiện có và chỉ nhận target chưa có owner.
- `migration`: nhận các symlink thuộc Foundation hoặc workspace cũ; foreign regular file vẫn block.
- `update`: active installation đã có install record.

Plan chứa fingerprint của mutation-relevant state. Nếu file hoặc symlink đổi giữa `plan` và `install`,
installer dừng và yêu cầu plan mới. Distribution được stage và verify trước khi đổi symlink; Control
Workspace chỉ được stage khi plan opt in. Trước mutation, installer ghi private transaction journal;
failure trong process sẽ tự rollback, còn process bị kill có thể recovery deterministically ở lần install
sau hoặc bằng lệnh explicit:

```bash
paseo-foundation recover
```

Recovery chỉ xóa release mới, và Control Workspace mới nếu plan đã opt in, khi checksum/fingerprint vẫn
khớp exact staged bytes. Nếu user đã sửa Control Workspace sau crash, recovery fail closed và giữ journal
để inspect thủ công.

Installer tạo:

```text
~/.local/share/paseo-foundation/releases/<version>/
~/.local/share/paseo-foundation/current -> releases/<version>
~/.paseo-foundation/install.json
~/.paseo-foundation/install-transaction.json  # chỉ tồn tại khi transaction chưa commit
```

Plan có `--with-control-workspace` mới tạo thêm `~/.paseo-control/`. Plan schema cũ chưa encode lựa chọn
này bị reject trước mutation và phải được tạo lại.

Nó chỉ thay các role/profile link đã classify là absent hoặc Foundation-owned theo mode. Nó không restart
daemon, không đổi active provider và không ghi vào project repository.

## Kiểm tra và quay lui

```bash
paseo-foundation doctor --project /absolute/path/to/project
paseo-foundation rollback
paseo-foundation uninstall
```

`doctor` báo năm gate độc lập:

- `DISTRIBUTION_VALID`: manifest và checksum.
- `RUNTIME_EFFECTIVE`: symlink readback và exact local daemon identity. Gate này yêu cầu local
  `config.json`, `server-id`, `paseo.pid`, live supervisor PID và status JSON. Live RPC phải trả đúng
  `serverId`, `listen`, một daemon-worker PID đang chạy và `daemonVersion`; một daemon khác reachable trên
  default port không thể làm gate xanh. Worker PID có thể khác supervisor PID trong `paseo.pid`.
- `ORCHESTRATION_READY`: route `providers.audit` phải tồn tại trong live catalog, model phải được
  configure và provider-connection receipt phải khớp exact daemon version, base URL, credential ref và
  credential digest hiện tại. Receipt cũ trả `UNKNOWN` với `verification stale`; provider/model sai trả
  `FAIL`.
- `ROLE_BOUNDARY_QUALIFIED`: static guards vẫn fail closed. Khi static bytes pass, gate chỉ `PASS` nếu có
  machine-readable Lead/Peer/Supervisor canary receipt khớp exact Foundation distribution/commit/role
  bytes, daemon server/start/version/source fingerprint và current connection-qualified route. Thiếu,
  partial hoặc stale receipt giữ `UNKNOWN`.
- `PROJECT_READY`: protocol vắng mặt là zero-delta và giữ `UNKNOWN`; protocol hiện diện nhưng invalid thì `FAIL`. Activation và engineering evidence vẫn có thể `UNKNOWN` sau khi byte gate pass.

`uninstall` chỉ gỡ owned runtime link; với migration record mới, nó restore exact legacy symlink snapshot.
Release cũ và một `~/.paseo-control` đã tồn tại được giữ để recovery và audit.

Migration record cũ thiếu `previousLinks` hoặc `previousCurrentTarget` không đủ evidence để restore. CLI
fail closed thay vì đoán target từ state đang active; dùng exact original install plan trong một bounded
recovery, hoặc giữ installation active và handback nếu snapshot không thể chứng minh.

Canary procedure tạo receipt ở một path tạm. Kiểm tra read-only trước, rồi chỉ record receipt sau khi đủ
evidence:

```bash
paseo-foundation doctor --role-canary /absolute/path/to/role-boundary-canary.json
paseo-foundation record-role-canary --receipt /absolute/path/to/role-boundary-canary.json
paseo-foundation doctor
```

`record-role-canary` không tự biến operator assertion thành evidence: nó chỉ nhận receipt đúng schema khi
bốn gate distribution/runtime/orchestration/role đều đang `PASS`, rồi lưu private file mode `0600` tại
`~/.paseo-foundation/role-boundary-canary.json`. Bất kỳ Foundation bytes, daemon build/start, route hoặc
connection qualification nào đổi đều làm receipt thành `UNKNOWN` cho tới canary mới.

## Thêm provider trên Paseo WebUI

Host và app phải cùng hỗ trợ feature `foundationCredentials`.

1. Mở **Settings → Host → Providers**.
2. Trong **Add provider**, chọn **Custom Codex → Add**.
3. Nhập Provider ID, Name, exact Model ID, Responses Base URL và API key riêng.
4. Chọn **Save**, mở lại **Connection**, rồi chọn **Test connection**. Probe chỉ gọi exact
   `POST <baseUrl>/responses` với model đã cấu hình; trạng thái chuyển sang **Connection verified** khi
   endpoint trả về một Responses API object hợp lệ. Agent mới dùng provider mới ngay; agent đang chạy giữ
   launch config cũ.

Base URL phải là absolute HTTPS URL, không chứa embedded credential, query hoặc fragment. WebUI chuẩn hóa
suffix `/v1`. Provider ID chỉ dùng lowercase letter, number và hyphen, bắt đầu bằng letter.

Để đổi endpoint hoặc rotate key, mở provider rồi chọn **Connection**. Để trống API key sẽ giữ credential
đang có. **Delete API key** là action destructive riêng và có confirmation; xóa provider config không tự
xóa secret để tránh phá provider alias khác đang dùng chung `credentialRef`.

Nhiều transport alias có thể dùng chung một `credentialRef`; WebUI phải giữ ref hiện có khi sửa endpoint
hoặc rotate key, thay vì đổi ref sang provider ID của alias. Xóa shared credential sẽ làm mọi provider dùng
ref đó fail closed cho tới khi lưu key mới.

Custom Codex provider mới chỉ là transport/cost route; role được chọn độc lập trong create flow.
WebUI đi theo `workspace → role → provider → model/config → spawn`. Daemon chỉ spawn sau khi compose được
immutable launch contract và preflight đủ exact model, URL, `credentialRef` cùng configured key. Custom
catalog không kế thừa model subscription. Nếu exact model ID cũng có trong Codex runtime catalog, Paseo
chỉ enrich model đó bằng `thinkingOptions` và default thinking level; model subscription khác vẫn không bị
expose vào custom provider. Sau fresh canary, dùng authoritative
`paseo agent inspect <agent-id> --json` để đọc effective `Role`, `ProviderId`, `Model` và
`CredentialConfigured`; agent tự mô tả route không phải evidence.

Qualification receipt chỉ giữ provider/model, fingerprint, timestamp và latency trong private file `0600`;
không giữ key hoặc base URL. Đổi endpoint, model, credential bytes hoặc daemon version làm receipt thành
**Verification stale** và cần chạy lại **Test connection**. Connection qualification không thay thế role,
tool-boundary hoặc end-to-end agent canary.

API key đi qua `foundation.credentials.set.request`, được daemon ghi trực tiếp vào private
`PASEO_HOME/config.json` tại:

```text
agents.credentials.<credentialRef>.OPENAI_API_KEY
```

`config.json` dùng private permission `0600`. Daemon đồng thời materialize một private runtime projection
tại `PASEO_HOME/credentials/providers/<credentialRef>.json` để tương thích với command-backed auth hiện
tại; file projection được regenerate từ config sau restart. Mutable provider config chỉ giữ
`credentialRef`, base URL và model metadata. Daemon tự resolve private credential-file path cho
command-backed auth; config RPC, status RPC, inspect output và WebUI không trả key hoặc path đó. Key không
nằm trong process arguments hoặc mutable provider environment.

Không đặt `OPENAI_API_KEY`, token, password hoặc secret vào mutable provider `env`; protocol tiếp tục
reject các field đó. Provider config có thể giữ non-secret metadata như `OPENAI_BASE_URL`.

## Control Workspace Home

Control Workspace hiện là deferred hypothesis, không phải prerequisite của Foundation. Flag
`--with-control-workspace` chỉ mở một experimental opt-in cho bounded pilot đã có reproduced
cross-project need, privacy boundary, owner và rollback path; package presence không chứng minh mechanism
đã được product-qualified.

`~/.paseo-control` giữ Portfolio Supervisor binding, Project Index, Supervisor Notebook, redacted episode
evidence và pending proposals. Nó không giữ project truth, engineering acceptance hoặc raw credentials.
Mỗi project repository vẫn sở hữu `WORKSPACE_PROTOCOL.md`, task evidence và engineering history của nó.

Điền toàn bộ placeholder trong Control Workspace trước khi dùng. Chỉ một writer được ghi
`SUPERVISOR_NOTEBOOK.md`; observer khác trả proposal hoặc handback để writer reconcile.

## Release maintainer flow

1. Freeze và tag Foundation commit sạch.
2. Rebase product branch lên exact upstream Paseo commit.
3. Import Foundation bằng `scripts/import-foundation.mjs` và review manifest/lock.
4. Chạy focused tests, typecheck, lint, format check, `npm pack --dry-run` để inspect artifact và
   `scripts/downstream-publish-guard.test.mjs` để giữ mọi package dưới upstream scope ở `private=true`.
5. Qualify daemon activation và role/tool boundary bằng fresh canary; lấy exact provider/model/mode từ
   daemon inspect readback, không từ agent self-report.

Git commit, static validator hoặc package dry-run không chứng minh runtime activation hay role boundary.
