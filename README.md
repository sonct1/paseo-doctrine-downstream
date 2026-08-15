# Paseo Foundation Downstream

This is the Paseo downstream distribution for role- and skill-bound Paseo Foundation workflows. It
packages the WebUI, CLI, Node.js runtime, and Foundation into a self-contained macOS artifact. It is
**not** an official installer from `getpaseo/paseo`; installable artifacts are published only from
[`webplode/paseo-doctrine-downstream`](https://github.com/webplode/paseo-doctrine-downstream).

## Install on macOS

Requirements:

- macOS on Apple Silicon (`arm64`) or Intel (`x64`);
- the system-provided `curl`, `tar`, and `shasum` commands;
- at least one installed and authenticated provider CLI, such as Claude Code or Codex.

Install the latest published downstream release:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-macos.sh | sh
```

To inspect the bootstrap script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-macos.sh -o /tmp/paseo-install-macos.sh
less /tmp/paseo-install-macos.sh
sh /tmp/paseo-install-macos.sh
```

The installer:

1. selects the newest published downstream release, including prereleases, for the host architecture;
2. downloads the artifact and its SHA-256 file, then verifies it before extraction;
3. detects an existing Paseo installation on `PATH`;
4. refuses replacement while an agent or workspace script is running or starting;
5. stops an idle daemon, installs into a versioned directory, and reads back the resulting state;
6. preserves user data and configuration under `~/.paseo`.

The default installation paths are:

```text
~/.local/share/paseo-web-cli/releases/<version>
~/.local/share/paseo-web-cli/current
~/.local/bin/paseo
~/.local/bin/paseo-foundation
~/.local/share/paseo-foundation
~/Library/LaunchAgents/com.paseo.web-cli.plist
```

If `~/.local/bin` is not already on `PATH`, add this line to `~/.zprofile` and open a new terminal:

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

Install files without stopping or starting the daemon:

```bash
curl -fsSL https://raw.githubusercontent.com/webplode/paseo-doctrine-downstream/main/scripts/install-macos.sh | sh -s -- --no-start
```

Run the same one-liner to upgrade. The installer writes the new release into a separate versioned
directory and updates the `current` symlink; it does not overwrite data in `~/.paseo`.

> A release must provide both `arm64` and `x64` artifacts. If the latest release does not contain the
> artifact for this Mac, the installer fails closed instead of switching to an official installer or
> silently selecting another build.

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

Paseo dùng external Beads Central `1.2.0` làm durable issue graph duy nhất. Daemon persist một stable
`workGraphId` cho mỗi project, pin actor từ role-bound session và enforce Lead/Peer/Supervisor authority
trước khi gọi Central. Artifact không bundle native `bd` và không có backend switch/fallback.

Xem [Beads Central issue graph](docs/beads-central.md) để biết binding, authority, WebUI và agent-tool
boundaries.

## Upstream Paseo 0.4

Bản `0.4.0-paseo.1` mang các capability mới của upstream vào distribution Foundation: reusable agent
profiles, managed local plugins, workspace file search và file actions, Mermaid preview, live task
progress, daemon config reload, provider refresh diagnostics, sortable workspace pins và các sửa lỗi
worktree/subagent. Downstream vẫn giữ native Rooms, `paseo loop`, role-bound assignments, Beads Central,
Councils và bộ cài macOS riêng.

## Uninstall

```bash
~/.local/share/paseo-web-cli/uninstall.sh
```

This preserves `~/.paseo`, workspaces, and the Foundation distribution. Remove Foundation only when
explicitly intended:

```bash
~/.local/share/paseo-web-cli/uninstall.sh --purge-foundation
```

## Development and release

```bash
npm ci
npm run build:server
npm run build:macos-web-cli-artifact
npm run test:macos-web-cli-artifact
```

A `paseo-v<package-version>` tag triggers the downstream workflow. GitHub Actions builds and smoke-tests
the macOS `arm64` and `x64` artifacts, then uploads each tarball and checksum to the downstream GitHub
Release.

Paseo Foundation Downstream is derived from
[`getpaseo/paseo`](https://github.com/getpaseo/paseo). License: AGPL-3.0.
