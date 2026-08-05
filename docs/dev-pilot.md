# Controlled dev pilot

Runbook này chỉ áp dụng cho `paseo-v0.3.0-beta.1.paseo.1-dev.1`. Đây là source-linked pilot nội bộ,
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
git checkout --detach paseo-v0.3.0-beta.1.paseo.1-dev.1
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
export PASEO_PILOT_PREFIX="$HOME/.local/share/paseo-dev-pilot/paseo-v0.3.0-beta.1.paseo.1-dev.1"
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

- `clean-empty`: chưa có Foundation, Control Workspace hoặc target link;
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
- `codex-lead`, `codex-peer` và `codex-supervisor` là available.

Doctor phải trả `DISTRIBUTION_VALID=PASS` và `RUNTIME_EFFECTIVE=PASS`. Doctor không ingest canary evidence,
nên `ROLE_BOUNDARY_QUALIFIED=UNKNOWN` vẫn cần canary độc lập; không đổi `UNKNOWN` thành `PASS` trong báo
cáo.

### Role boundary canary

Chạy từng canary read-only trong disposable repository có current `WORKSPACE_PROTOCOL.md`, lưu agent ID và
archive sau readback:

| Provider           | Exact canary lease                                                                                         | Pass condition                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `codex-lead`       | Đọc full protocol, trả role marker và provider/model; không edit, không delegate                           | Đọc được full protocol, route đúng `codex-lead`, không mutation                                   |
| `codex-peer`       | Không đọc full protocol; trả role marker và tool visibility; không edit                                    | Không có full-protocol access và không có Paseo coordination tools                                |
| `codex-supervisor` | Governance canary read-only; trả role marker, provider/model và tool visibility; không create/update agent | Chỉ thấy inspection/supervision surface đã cấp, không nhận engineering write/acceptance authority |

Một provider visible hoặc selectable không đủ làm canary xanh. Provider/model phải đúng exact route;
generic fallback là failure.

### WebUI và custom route

Mở **Settings → Host → Providers** và xác nhận form **Connection** nhận Base URL cùng API key nhưng không
render lại secret sau save. Không đưa secret vào screenshot, log, issue hoặc handback.

Các alias `codex-*-cliproxy` trong Foundation template mặc định disabled. Với endpoint riêng:

1. điền Base URL và credential bằng **Connection**;
2. chạy fresh exact role/tool canary;
3. chỉ enable alias sau khi canary xanh;
4. dừng nếu alias fallback sang provider/model khác.

`Configured · qualification pending` là trạng thái đúng trước canary. Model catalog inherited không chứng
minh endpoint hoặc role binding.

### Product task

Sau khi ba role canary xanh, chạy một task read-only rồi một task ghi nhỏ trong disposable repository.
Task ghi phải có một Owner, exact file scope, focused test và handback. Pass khi diff chỉ chứa scope được
cấp, test tái hiện objective xanh, agent đã archive và Human vẫn giữ acceptance authority.

## Stop conditions

Dừng pilot, không tự repair ngoài lease, khi có một trong các dấu hiệu:

- source tag, CLI version và daemon version không đồng nhất;
- Foundation plan đụng foreign file, unknown owner hoặc stale fingerprint;
- daemon identity readback không khớp hoặc bind ra ngoài localhost;
- status/config/evidence trả credential value;
- Peer đọc full protocol hoặc thấy Paseo coordination tools;
- Supervisor bypass Lead hoặc nhận engineering acceptance authority;
- exact provider/model route fallback;
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

`uninstall` giữ release và `~/.paseo-control` để audit/recovery. Gỡ source-linked CLI khỏi shell bằng cách
mở shell mới hoặc bỏ pilot prefix khỏi `PATH`. Muốn thu hồi prefix theo cách recoverable trên macOS:

```bash
mv "$PASEO_PILOT_PREFIX" \
  "$HOME/.Trash/$(basename "$PASEO_PILOT_PREFIX")-$(date +%Y%m%d%H%M%S)"
```

Không xóa checkout trước khi prefix đã được thu hồi vì npm links trỏ vào checkout đó.

## Known limits của tag

- Đây là source-linked pilot; npm packages, Docker image và native desktop/mobile artifacts chưa publish.
- Native release slot vẫn theo upstream beta slot; suffix `.paseo.1` chưa có independent native channel.
- `doctor` chưa ingest signed/fresh role canary evidence.
- Custom cost route chưa qualified nếu tester chưa cung cấp endpoint/credential và chạy exact canary.
- Dependency graph hiện có 51 npm advisories: 5 low, 26 moderate, 18 high, 2 critical. Critical findings nằm
  trong app/build/mobile dependency tree; direct runtime `ws` vẫn có high advisory ở `8.20.0`. Pilot vì
  thế chỉ được chạy localhost, không relay/LAN/public exposure.
- Qualification hiện tại chỉ bao phủ macOS arm64 và WebUI browser smoke. Windows, Linux, Intel macOS,
  native desktop/mobile packaging và remote relay vẫn `UNKNOWN`.

## Handback tối thiểu

Mỗi tester gửi:

- OS/architecture, Node.js và npm version;
- exact tag và commit;
- redacted `paseo daemon status --json`;
- bốn doctor gate giữ nguyên `PASS/FAIL/UNKNOWN`;
- provider/model, agent ID và pass/fail của từng canary;
- command, exact error và smallest reproducer cho failure;
- `git status --short` và `git diff --check` của disposable project;
- rollback/uninstall result.

Không gửi API key, credential file, raw provider config có secret hoặc nội dung user repository ngoài
pilot scope.
