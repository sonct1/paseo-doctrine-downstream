# Paseo Foundation Downstream

Đây là bản phân phối downstream của Paseo dành cho workflow có role và skill của Paseo Foundation.
Nó đóng gói WebUI, CLI, Node runtime và Foundation thành một artifact macOS tự chứa. Đây **không phải**
installer chính chủ từ `getpaseo/paseo`; mọi artifact cài đặt đều được phát hành từ
[`webplode/paseo-doctrine-downstream`](https://github.com/webplode/paseo-doctrine-downstream).

## Cài trên macOS

Yêu cầu:

- macOS Apple Silicon (`arm64`) hoặc Intel (`x64`);
- `curl`, `tar` và `shasum` có sẵn trong hệ thống;
- ít nhất một provider CLI đã được cài và đăng nhập, ví dụ Claude Code hoặc Codex.

Cài release downstream mới nhất bằng một lệnh:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-macos.sh | sh
```

Muốn đọc script trước khi chạy:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-macos.sh -o /tmp/paseo-install-macos.sh
less /tmp/paseo-install-macos.sh
sh /tmp/paseo-install-macos.sh
```

Installer sẽ:

1. chọn release downstream được publish mới nhất, kể cả prerelease, và đúng kiến trúc máy;
2. tải artifact cùng file SHA-256 rồi xác minh trước khi giải nén;
3. phát hiện Paseo đang có trên `PATH`;
4. từ chối thay thế nếu có agent hoặc workspace script đang chạy/khởi động;
5. dừng daemon cũ khi nó đang chạy nhưng đã idle, cài bản mới theo version, rồi đọc lại trạng thái;
6. giữ nguyên dữ liệu và cấu hình người dùng trong `~/.paseo`.

Mặc định, bản cài nằm ở:

```text
~/.local/share/paseo-web-cli/releases/<version>
~/.local/share/paseo-web-cli/current
~/.local/bin/paseo
~/.local/bin/paseo-foundation
~/.local/share/paseo-foundation
~/Library/LaunchAgents/com.paseo.web-cli.plist
```

Nếu `~/.local/bin` chưa có trong `PATH`, thêm dòng này vào `~/.zprofile` rồi mở terminal mới:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Kiểm tra sau khi cài:

```bash
~/.local/bin/paseo --version
~/.local/bin/paseo daemon status
~/.local/bin/paseo-foundation doctor
open http://127.0.0.1:6767
```

Chỉ cài file, không dừng hoặc khởi động daemon:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-macos.sh | sh -s -- --no-start
```

Chạy lại one-liner để nâng cấp. Installer ghi release mới vào thư mục version riêng và cập nhật symlink
`current`; nó không cài đè dữ liệu trong `~/.paseo`.

> Release phải có đủ artifact `arm64` và `x64`. Nếu release mới nhất chưa publish artifact tương ứng,
> installer sẽ fail closed thay vì chuyển sang installer chính chủ hoặc âm thầm chọn build khác.

## Foundation đi kèm

Artifact cài Foundation distribution và project role bindings vào các provider được hỗ trợ. Bundle mặc định:

- Lead: không có standing audit skill; `repo-refresh` chỉ được cấp explicit khi cần.
- Peer: `frontend-design`.
- Supervisor: `paseo-supervisor`, `architecture-premise-audit`, `test-proof-debt-audit`.
- `ultra-review` được đóng gói nhưng không bật mặc định cho role nào.

Đọc [Foundation product guide](docs/foundation-product.md) để xem role contract, provider projection và
các lệnh `inspect`, `plan`, `install`, `doctor`, `rollback`.

## Gỡ cài đặt

```bash
~/.local/share/paseo-web-cli/uninstall.sh
```

Lệnh trên giữ `~/.paseo`, workspace và Foundation distribution. Chỉ xóa cả Foundation khi chủ động yêu cầu:

```bash
~/.local/share/paseo-web-cli/uninstall.sh --purge-foundation
```

## Phát triển và phát hành

```bash
npm ci
npm run build:server
npm run build:macos-web-cli-artifact
npm run test:macos-web-cli-artifact
```

Tag dạng `paseo-v<package-version>` kích hoạt workflow build artifact macOS cho `arm64` và `x64`, smoke
test, rồi upload tarball cùng checksum vào GitHub Release của downstream.

Paseo Foundation Downstream kế thừa mã nguồn từ
[`getpaseo/paseo`](https://github.com/getpaseo/paseo). License: AGPL-3.0.
