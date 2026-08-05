# Paseo Foundation product

Paseo Foundation được ship cùng repository này nhưng giữ ba lifecycle riêng:

- `foundation/dist` là doctrine và role asset immutable, được import từ exact tagged Foundation commit.
- Paseo daemon, app và protocol là runtime downstream bám upstream Paseo.
- `control-workspace/template` là seed cho Control Workspace Home mutable, user-owned.

Không sửa `foundation/dist` trực tiếp. Thay đổi doctrine ở repository Foundation, tag một commit sạch,
rồi chạy `scripts/import-foundation.mjs`. `foundation/manifest.json` khóa SHA-256 từng file;
`foundation/sources.lock.json` khóa Foundation commit và Paseo upstream commit.

## Cài trên macOS

Cài CLI trên macOS với Node.js 20 trở lên:

```bash
npm install -g @getpaseo/foundation-cli
```

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

Chọn mode theo state đã inspect:

- `clean-empty`: máy chưa có Foundation, Control Workspace hoặc target link.
- `coexist`: giữ config/tool hiện có và chỉ nhận target chưa có owner.
- `migration`: nhận các symlink thuộc Foundation hoặc workspace cũ; foreign regular file vẫn block.
- `update`: active installation đã có install record.

Plan chứa fingerprint của mutation-relevant state. Nếu file hoặc symlink đổi giữa `plan` và `install`,
installer dừng và yêu cầu plan mới. Distribution được stage rồi verify checksum trước khi đổi symlink.
Failure giữa chừng rollback link, release mới, Control Workspace mới và install record.

Installer tạo:

```text
~/.local/share/paseo-foundation/releases/<version>/
~/.local/share/paseo-foundation/current -> releases/<version>
~/.paseo-foundation/install.json
~/.paseo-control/
```

Nó chỉ thay các role/profile link đã classify là absent hoặc Foundation-owned theo mode. Nó không restart
daemon, không đổi active provider và không ghi vào project repository.

## Kiểm tra và quay lui

```bash
paseo-foundation doctor --project /absolute/path/to/project
paseo-foundation rollback
paseo-foundation uninstall
```

`doctor` báo bốn gate độc lập:

- `DISTRIBUTION_VALID`: manifest và checksum.
- `RUNTIME_EFFECTIVE`: symlink readback và daemon reachability.
- `ROLE_BOUNDARY_QUALIFIED`: static guards; giữ `UNKNOWN` cho tới khi có fresh role/tool canary.
- `PROJECT_READY`: protocol bytes; activation và engineering evidence vẫn có thể `UNKNOWN`.

`uninstall` chỉ gỡ owned runtime link. Release cũ và `~/.paseo-control` được giữ để recovery và audit.

## Thêm provider trên Paseo WebUI

Host và app phải cùng hỗ trợ feature `foundationCredentials`.

1. Mở **Settings → Host → Providers**.
2. Trong **Add provider**, chọn **OpenAI-compatible → Add**.
3. Nhập Provider ID, Name, Responses Base URL và API key riêng.
4. Chọn **Save**. Agent mới dùng provider mới ngay; agent đang chạy giữ launch config cũ.

Base URL phải là absolute HTTPS URL, không chứa embedded credential, query hoặc fragment. WebUI chuẩn hóa
suffix `/v1`. Provider ID chỉ dùng lowercase letter, number và hyphen, bắt đầu bằng letter.

Để đổi endpoint hoặc rotate key, mở provider rồi chọn **Connection**. Để trống API key sẽ giữ credential
đang có.

Provider OpenAI-compatible mới chỉ là transport/cost route, không tự chứng minh role binding. Muốn dùng
Lead, Peer hoặc Supervisor của Foundation, giữ exact role-specific provider command từ
`foundation/dist/templates/paseo-provider-overrides.example.json`, rồi dùng **Connection** để điền endpoint
và credential cho provider đó. Chỉ enable sau fresh role/tool canary. Wrapper role-specific cần `jq`;
`paseo-foundation inspect` báo path/version của tool này.

API key đi qua `foundation.credentials.set.request`, được daemon ghi vào:

```text
PASEO_HOME/credentials/providers/<credentialRef>.json
```

File và parent directory dùng private permissions. Provider config chỉ giữ `credentialRef`, base URL và
credential-file path; config RPC, status RPC, inspect output và WebUI không trả key. Codex đọc key bằng
command-backed auth lúc launch, nên key không nằm trong process arguments hoặc provider config.

Không đặt `OPENAI_API_KEY`, token, password hoặc secret vào mutable provider `env`; protocol reject các
field đó. Provider config có thể giữ non-secret metadata như `OPENAI_BASE_URL`.

## Control Workspace Home

`~/.paseo-control` giữ Portfolio Supervisor binding, Project Index, Supervisor Notebook, redacted episode
evidence và pending proposals. Nó không giữ project truth, engineering acceptance hoặc raw credentials.
Mỗi project repository vẫn sở hữu `WORKSPACE_PROTOCOL.md`, task evidence và engineering history của nó.

Điền toàn bộ placeholder trong Control Workspace trước khi dùng. Chỉ một writer được ghi
`SUPERVISOR_NOTEBOOK.md`; observer khác trả proposal hoặc handback để writer reconcile.

## Release maintainer flow

1. Freeze và tag Foundation commit sạch.
2. Rebase product branch lên exact upstream Paseo commit.
3. Import Foundation bằng `scripts/import-foundation.mjs` và review manifest/lock.
4. Chạy focused tests, typecheck, lint, format check và `npm publish --dry-run` cho
   `@getpaseo/foundation-cli`.
5. Qualify daemon activation và role/tool boundary bằng fresh canary trước khi gọi release-ready.

Git commit, static validator hoặc package dry-run không chứng minh runtime activation hay role boundary.
