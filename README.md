# Paseo Foundation Downstream

This is the Paseo downstream distribution for role- and skill-bound Paseo Foundation workflows. It
packages the WebUI, CLI, Node.js runtime, and Foundation into self-contained host-native artifacts. It is
**not** an official installer from `getpaseo/paseo`; installable artifacts are published only from
[`webplode/paseo-doctrine-downstream`](https://github.com/webplode/paseo-doctrine-downstream).

Host-native artifacts are published for macOS (`arm64`, `x64`), Linux (`x64`), and Windows (`x64`).
Every artifact bundles the same downstream version and is built, installed, and smoke-tested on its
target operating system before publication.

## Install

At least one provider CLI, such as Claude Code or Codex, must already be installed and authenticated.
The installer preserves provider configuration and all user data under `~/.paseo`.

### macOS

Requirements:

- macOS on Apple Silicon (`arm64`) or Intel (`x64`);
- the system-provided `curl`, `tar`, and `shasum` commands;
- a normal interactive user account with `launchd`.

Install the latest published downstream release:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install.sh | sh
```

To inspect the bootstrap script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install.sh -o /tmp/paseo-install.sh
less /tmp/paseo-install.sh
sh /tmp/paseo-install.sh
```

The daemon is installed as `~/Library/LaunchAgents/com.paseo.web-cli.plist`.

### Linux

Requirements:

- an `x86_64` Linux distribution;
- `curl`, `tar`, `sha256sum`, and a working user `systemd` session.

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install.sh | sh
```

The daemon is installed as `~/.config/systemd/user/paseo-web-cli.service`. On a headless machine,
enable user lingering first if the service must keep running after logout:

```bash
loginctl enable-linger "$USER"
```

### Windows

Requirements:

- 64-bit Windows 10/11 or Windows Server;
- Windows PowerShell 5.1 or newer.

Run from PowerShell as the normal user; administrator privileges are not required:

```powershell
irm https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-windows.ps1 | iex
```

To inspect the script first:

```powershell
$installer = Join-Path $env:TEMP "paseo-install-windows.ps1"
Invoke-WebRequest https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-windows.ps1 -OutFile $installer
Get-Content $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

The installer adds `%LOCALAPPDATA%\Paseo\bin` to the user `PATH` and registers the user Scheduled Task
`Paseo WebUI CLI`. Open a new terminal after the first installation so it sees the updated `PATH`.

### What the installer does

The installer:

1. selects the newest published downstream release for the host operating system and architecture;
2. downloads the artifact and its SHA-256 file, then verifies it before extraction;
3. detects an existing Paseo installation on `PATH`;
4. refuses replacement while an agent or workspace script is running or starting;
5. stops an idle daemon, installs into a versioned directory, and configures the native user service;
6. starts the daemon and requires an authoritative CLI/daemon readback;
7. installs or updates the bundled Foundation distribution;
8. preserves user data and configuration under `~/.paseo`.

The default Unix installation paths are:

```text
~/.local/share/paseo-web-cli/releases/<version>
~/.local/share/paseo-web-cli/current
~/.local/bin/paseo
~/.local/bin/paseo-foundation
~/.local/share/paseo-foundation
~/Library/LaunchAgents/com.paseo.web-cli.plist
```

Linux uses the same `~/.local` release and CLI paths, plus the user systemd unit shown above. Windows
uses `%LOCALAPPDATA%\PaseoWebCli` for versioned releases and `%LOCALAPPDATA%\Paseo\bin` for commands.

If `~/.local/bin` is not already on `PATH`, add this line to `~/.zprofile` on macOS or `~/.profile`
on Linux, then open a new terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Verify the installation:

```bash
~/.local/bin/paseo --version
~/.local/bin/paseo daemon status
~/.local/bin/paseo-foundation doctor
open http://127.0.0.1:6767
```

On Linux, replace `open` with `xdg-open`. On Windows:

```powershell
paseo --version
paseo daemon status
paseo-foundation --version
paseo-foundation doctor
Start-Process http://127.0.0.1:6767
```

Install files without stopping or starting the daemon:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install.sh | sh -s -- --no-start
```

On Windows, download the bootstrap script and pass `-NoStart`. Run the same OS-specific installer to
upgrade; releases are staged side by side before the active pointer is changed.

Run the same one-liner to upgrade. The installer writes the new release into a separate versioned
directory and updates the active pointer; it does not overwrite data in `~/.paseo`.

> If the latest release does not contain an artifact for the exact host OS and architecture, the
> installer fails closed instead of switching to an upstream installer or another build.

## Bundled Foundation

The artifact installs the Foundation distribution and supported provider role bindings. The default
skill projection is:

- Lead: no standing audit skill; `repo-refresh` is explicit-only.
- Peer: `beads-issue-tracker`, `frontend-design`.
- Supervisor: `beads-issue-tracker`, `paseo-supervisor`, `architecture-premise-audit`, and `test-proof-debt-audit`.
- Lead also receives the mandatory `beads-issue-tracker`.
- `ultra-review` is packaged but disabled for every standing role.

See the [Foundation product guide](docs/foundation-product.md) for role contracts, provider projection,
and the `inspect`, `plan`, `install`, `doctor`, and `rollback` commands.

## Beads Central

Paseo bundle Beads Central `1.2.0` cùng `bd 1.1.2` như một sidecar component của Product. Daemon sở hữu
startup/readiness/shutdown của component, persist một stable `workGraphId` cho mỗi project, pin actor từ
role-bound session và enforce Lead/Peer/Supervisor authority trước khi gọi Central. Không cần Docker,
external deployment hoặc backend switch/fallback.

Xem [Beads Central issue graph](docs/beads-central.md) để biết binding, authority, WebUI và agent-tool
boundaries.

## Upstream Paseo 0.4

Bản `0.4.0-paseo.1` mang các capability mới của upstream vào distribution Foundation: reusable agent
profiles, managed local plugins, workspace file search và file actions, Mermaid preview, live task
progress, daemon config reload, provider refresh diagnostics, sortable workspace pins và các sửa lỗi
worktree/subagent. Downstream vẫn giữ native Rooms, `paseo loop`, role-bound assignments, Beads Central,
Councils và bộ cài host-native riêng.

## Uninstall

```bash
~/.local/share/paseo-web-cli/uninstall.sh
```

This preserves `~/.paseo`, workspaces, and the Foundation distribution. Remove Foundation only when
explicitly intended:

```bash
~/.local/share/paseo-web-cli/uninstall.sh --purge-foundation
```

On Windows:

```powershell
& "$env:LOCALAPPDATA\PaseoWebCli\uninstall.ps1"
```

Add `-PurgeFoundation` only when the Foundation distribution should also be removed.

## Development and release

```bash
npm ci
npm run build:web-cli-artifact
npm run test:web-cli-artifact
```

A `paseo-v<package-version>` tag triggers the downstream workflow. GitHub Actions builds and smoke-tests
macOS `arm64`/`x64`, Linux `x64`, and Windows `x64` on native runners, then uploads each archive and
checksum to the downstream GitHub Release. A manual run with `publish=false` qualifies an exact commit
without creating a release.

Paseo Foundation Downstream is derived from
[`getpaseo/paseo`](https://github.com/getpaseo/paseo). License: AGPL-3.0.
