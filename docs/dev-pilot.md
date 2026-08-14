# Controlled dev pilot

Runbook này chỉ áp dụng cho `paseo-v0.3.0-beta.1.paseo.1-dev.4`. Đây là source-linked pilot nội bộ,
không phải package release hoặc native app release.

## Phạm vi

Pilot kiểm tra bốn lớp:

1. exact source tag build và chạy được trên macOS;
2. Foundation installer không ghi đè foreign state;
3. daemon, WebUI và role profile chạy đúng downstream version;
4. một task read-only và một task nhỏ trong disposable repository đi hết lifecycle.

Mỗi pilot dùng một macOS user riêng hoặc một máy không có agent quan trọng đang chạy. Chỉ bind
`127.0.0.1`, tắt relay và không dùng production repository cho task ghi đầu tiên. Exact platform đã được
qualify trước khi tag: macOS 26.5.1 arm64, Node.js 26.5.0, npm 11.17.0. Foundation CLI yêu cầu Node.js
`>=20` và npm `>=9`; platform/version khác là evidence mới, không kế thừa qualification này.

## Lấy exact source

```bash
git clone https://github.com/webplode/paseo-doctrine-downstream.git paseo-dev-pilot
cd paseo-dev-pilot
git fetch --tags origin
git checkout --detach paseo-v0.3.0-beta.1.paseo.1-dev.4
git describe --tags --exact-match
git status --short
```

Hai lệnh cuối phải trả exact tag và working tree rỗng. Dừng nếu tag không tồn tại, checkout có local
change hoặc commit không match tag.

Build exact checkout:

```bash
npm ci
npm run build:server:clean
npm run build:daemon-web-ui
node packages/foundation-cli/prepare-assets.mjs
npm run build --workspace=@getpaseo/foundation-cli
```

Không overwrite global CLI. Link hai package vào prefix riêng và giữ checkout tại nguyên path trong suốt
pilot:

```bash
export PASEO_PILOT_PREFIX="$HOME/.local/share/paseo-dev-pilot/paseo-v0.3.0-beta.1.paseo.1-dev.4"
mkdir -p "$PASEO_PILOT_PREFIX"
npm_config_prefix="$PASEO_PILOT_PREFIX" npm link --workspace=@getpaseo/cli
npm_config_prefix="$PASEO_PILOT_PREFIX" npm link --workspace=@getpaseo/foundation-cli
export PATH="$PASEO_PILOT_PREFIX/bin:$PATH"
paseo --version
paseo-foundation --version
```

Cả hai version phải là `0.3.0-beta.1.paseo.1`. Shell mới phải export lại `PASEO_PILOT_PREFIX` và `PATH`.

## Inspect và cài Foundation

Chạy inspect trước mọi mutation:

```bash
paseo-foundation inspect --product-root "$PWD"
paseo-foundation inspect --product-root "$PWD" --json
```

Chọn mode từ exact inspection, không chọn theo lịch sử máy:

- `clean-empty`: chưa có Foundation hoặc target link; Control Workspace chỉ được xét khi plan opt in;
- `coexist`: giữ config/tool hiện có, chỉ nhận target chưa có owner;
- `migration`: chỉ nhận symlink đã classify là Foundation-owned hoặc legacy-owned;
- `update`: install record đang active.

Foreign regular file hoặc owner không xác định là stop condition. Không move, delete hoặc overwrite file
để ép plan qua. Tạo plan bằng mode đã review:

```bash
paseo-foundation plan \
  --mode <reviewed-mode> \
  --product-root "$PWD" \
  --output "$HOME/.paseo-foundation/install-plan.json"
paseo-foundation install \
  --plan "$HOME/.paseo-foundation/install-plan.json"
```

Mặc định plan không tạo `~/.paseo-control`. Chỉ thêm `--with-control-workspace` vào lệnh `plan` cho một
bounded experimental pilot đã có reproduced cross-project need, privacy boundary, owner và rollback path.

Nếu state đổi sau plan, installer phải fail closed. Chạy lại `inspect`, review delta rồi tạo plan mới. Không
restart daemon như side effect của Foundation install.

## Chạy daemon và WebUI

Kiểm tra daemon hiện có trước:

```bash
paseo daemon status --json
```

Nếu máy đang có daemon hoặc agent quan trọng, dừng pilot cho tới khi owner cấp quyền stop/restart. Trên
pilot user không có daemon, chạy local-only:

```bash
PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD=0 \
PASEO_DICTATION_ENABLED=0 \
PASEO_VOICE_MODE_ENABLED=0 \
paseo daemon start \
  --listen 127.0.0.1:6767 \
  --web-ui \
  --no-relay
```

Mở `http://127.0.0.1:6767`. Không đổi bind address, bật relay hoặc expose qua reverse proxy trong pilot
này.

## Acceptance gates

### Runtime identity

```bash
paseo daemon status --json
paseo-foundation doctor --project /absolute/path/to/disposable-project
```

Status phải chứng minh:

- `localDaemon` là `running` và `connectedDaemon` là `reachable`;
- `serverId` bằng `connectedServerId`;
- `listen` và `connectedListen` đều là `127.0.0.1:6767`;
- `cliVersion` và `daemonVersion` đều là `0.3.0-beta.1.paseo.1`;
- built-in `codex` và custom Codex provider dự kiến dùng trong pilot đều available và khai báo native role
  binding support.

Doctor phải trả `DISTRIBUTION_VALID=PASS` và `RUNTIME_EFFECTIVE=PASS`. Doctor không ingest canary evidence,
nên `ROLE_BOUNDARY_QUALIFIED=UNKNOWN` vẫn cần canary độc lập; không đổi `UNKNOWN` thành `PASS` trong báo
cáo.

### Role boundary canary

Chạy từng canary read-only trong disposable repository có current `WORKSPACE_PROTOCOL.md`, lưu agent ID và
archive sau readback:

| Role + provider route               | Exact canary lease                                                                         | Pass condition                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `lead` + built-in `codex`           | Đọc full protocol, trả role marker và tool visibility; không edit, không delegate          | Đúng Lead authority; inspect pin `codex`, `openai`, exact model và ChatGPT credential configured |
| `peer` + transport-only route       | Không đọc full protocol; trả role marker và tool visibility; không edit                    | Không có coordination tools; inspect pin exact selected provider/model/auth route                |
| `supervisor` + transport-only route | Governance canary read-only; trả role marker và tool visibility; không create/update agent | Chỉ có supervision surface; inspect pin exact selected route, không có fallback                  |

Với Codex và provider defer MCP tools, lease phải cho phép provider-native `ToolSearch` chỉ để resolve
exact terminal logical selector trước action call. Một prompt cấm mọi auxiliary tool sẽ tự chặn deferred
discovery; kết quả đó là `INVALID_CANARY/UNTESTABLE`, không chứng minh tool projection bị thiếu. Sau
discovery, canary vẫn chỉ được gọi action tools nằm trong exact lease.

Sau mỗi canary, đọc route từ daemon thay vì hỏi agent tự mô tả:

```bash
paseo agent inspect <agent-id> --json
```

`Role`, `LaunchContract.ProviderId`, `LaunchContract.Model`, `LaunchContract.ModelProviderId` và
`CredentialConfigured` trong inspect output phải khớp exact assignment. Agent tự mô tả provider/model không
phải route evidence; câu trả lời đó có thể phản ánh model family thay vì logical provider của Paseo. Một
provider visible hoặc selectable cũng không đủ làm canary xanh. Inspect readback lệch route hoặc generic
fallback là failure.

### Evidence-source boundary

Canary mặc định cho phép global operational context, nhưng Memory, skill, preference hoặc historical plan
không được dùng để cấp authority, suy ra project truth hoặc thay current-byte verification. Handback phải
nêu evidence nào đến từ repository và evidence nào chỉ là operational context.

Nếu một qualification claim yêu cầu `current-bytes-only`, exact lease phải cấm rõ Memory, user-home và
history. Bất kỳ access nào vào nguồn bị cấm làm episode evidence không hợp lệ; chạy lại bằng fresh agent
với source boundary phù hợp. Built-in Codex dùng native auth store trong `CODEX_HOME`; custom endpoint dùng
private Paseo credential store và không cần đổi `CODEX_HOME`. Chỉ dùng isolated Codex home khi canary thật
sự yêu cầu một login/session store độc lập đã review.

### WebUI và custom route

Mở **Settings → Host → Providers** và xác nhận form **Connection** nhận Base URL cùng API key nhưng không
render lại secret sau save. Không đưa secret vào screenshot, log, issue hoặc handback.

Với custom OpenAI-compatible endpoint:

1. tạo provider với exact model, Base URL và credential bằng **Connection**;
2. trong create flow chọn role, custom provider rồi exact model;
3. chạy fresh exact role/tool canary;
4. dùng `paseo agent inspect <agent-id> --json` để xác nhận exact role/provider/model/auth route;
5. dừng nếu inspect readback cho thấy fallback sang provider/model khác.

Model catalog inherited không được xuất hiện trên custom route và không chứng minh endpoint hoặc role
binding. Thiếu URL/key/model phải fail trước launch, không thử built-in subscription.

### Product task

Sau khi ba role canary xanh, chạy một task read-only rồi một task ghi nhỏ trong disposable repository.
Task ghi phải có một Owner, exact file scope, focused test và handback. Pass khi diff chỉ chứa scope được
cấp, test tái hiện objective xanh, agent đã archive và Human vẫn giữ acceptance authority.

## Stop conditions

Dừng pilot, không tự repair ngoài lease, khi có một trong các dấu hiệu:

- source tag, CLI version và daemon version không đồng nhất;
- Foundation plan đụng foreign file, unknown owner hoặc stale fingerprint;
- daemon identity readback không khớp hoặc bind ra ngoài localhost;
- status RPC, mutable config RPC, inspect hoặc evidence trả credential value; raw `config.json` trên host
  có credential theo explicit product policy và không được đưa vào handback;
- Peer đọc full protocol hoặc thấy Paseo coordination tools;
- Supervisor bypass Lead hoặc nhận engineering acceptance authority;
- daemon inspect readback lệch exact provider/model/mode assignment;
- canary khai báo `current-bytes-only` nhưng agent truy cập Memory, user-home hoặc history;
- read-only canary làm thay đổi repository;
- daemon crash, transaction journal không recovery được hoặc rollback không giữ user-owned state.

Giữ exact command, error text, redacted status và `git diff` để handback. Không sửa global config, restart
daemon khác hoặc xóa state để tiếp tục.

## Rollback

Chỉ stop daemon do pilot này sở hữu:

```bash
paseo daemon stop
```

Với update đã có previous Foundation release, chạy `paseo-foundation rollback`. Với first install hoặc khi
muốn gỡ owned runtime links, chạy:

```bash
paseo-foundation uninstall
```

`uninstall` giữ release và một `~/.paseo-control` đã tồn tại để audit/recovery. Gỡ source-linked CLI khỏi shell bằng cách
mở shell mới hoặc bỏ pilot prefix khỏi `PATH`. Muốn thu hồi prefix theo cách recoverable trên macOS:

```bash
mv "$PASEO_PILOT_PREFIX" \
  "$HOME/.Trash/$(basename "$PASEO_PILOT_PREFIX")-$(date +%Y%m%d%H%M%S)"
```

Không xóa checkout trước khi prefix đã được thu hồi vì npm links trỏ vào checkout đó.

Installer mới giữ exact previous-link snapshot cho migration. Một install record tạo bởi build cũ có thể
thiếu snapshot này; `rollback` hoặc `uninstall` phải dừng với error chứa
`migration install record lacks an exact previous-link snapshot`. Không suy ra legacy target từ các link
Foundation đang active và không sửa record bằng state hiện tại. Giữ record, exact original install plan và
error để handback; nếu original plan không còn hoặc không chứng minh đủ previous target thì giữ Foundation
active cho tới khi owner cấp một recovery lease riêng.

## Known limits của tag

- Đây là source-linked pilot; npm packages, Docker image và native desktop/mobile artifacts chưa publish.
- Native release slot vẫn theo upstream beta slot; suffix `.paseo.1` chưa có independent native channel.
- `doctor` chưa ingest signed/fresh role canary evidence.
- Custom cost route chưa qualified nếu tester chưa cung cấp endpoint/credential và chạy exact canary.
- Frozen `npm ci` qualification ngày 2026-08-05 báo 83 npm advisories: 7 low, 38 moderate, 31 high và 7
  critical. Dependency remediation nằm ngoài scope của tag này; giữ exact `npm ci`/`npm audit` output trong
  handback và chỉ chạy pilot trên localhost, không relay/LAN/public exposure.
- Qualification hiện tại chỉ bao phủ macOS arm64 và WebUI browser smoke. Windows, Linux, Intel macOS,
  native desktop/mobile packaging và remote relay vẫn `UNKNOWN`.

## Handback tối thiểu

Mỗi tester gửi:

- OS/architecture, Node.js và npm version;
- exact tag và commit;
- redacted `paseo daemon status --json`;
- bốn doctor gate giữ nguyên `PASS/FAIL/UNKNOWN`;
- authoritative `paseo agent inspect <agent-id> --json` đã redact cùng pass/fail của từng canary;
- command, exact error và smallest reproducer cho failure;
- `git status --short` và `git diff --check` của disposable project;
- rollback/uninstall result.

Không gửi API key, credential file, raw `config.json`, provider config có secret hoặc nội dung user
repository ngoài pilot scope.
