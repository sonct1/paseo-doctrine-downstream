# Tích hợp upstream Paseo v0.6.0 stable

## Kết luận

- Quyết định: `MERGE WITH ADAPTATION` exact annotated tag `v0.6.0`, peeled commit
  `6da9fa43fa97629af365c280b2ad7d0e7692c025`.
- Input không gồm `upstream/main`; commit post-release `c778c47b306332cfa7885778a0f31f1eca3958eb`
  chỉ refresh lockfile/Nix hash và nằm ngoài boundary.
- Baseline Product là exact snapshot `0.5.0-paseo.43` đã checkpoint riêng, sau đó nhận commit
  `e58bacb4639a1c378794c578c304fcbf3178df16` từ `origin/main` trước semantic merge.
- Version downstream đích là `0.6.0-paseo.44`; suffix tăng vì `.43` đã được build và cài local.

## Upstream delta

Từ upstream `v0.5.0` tới `v0.6.0` có 21 commits, 230 files, 9.675 insertions và 5.463 deletions.

| Release                      | Quyết định              | Nội dung nhận                                                                                                             |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `v0.5.1`                     | `MERGE`                 | Sửa multiline composer mất resize sau workspace/agent transition trên iOS và Android.                                     |
| `v0.5.2`                     | `MERGE`                 | Sửa crash Android tablet/foldable và giữ settings hợp lệ khi app revision khác nhau.                                      |
| `v0.6.0` Explorer            | `MERGE WITH ADAPTATION` | Dedicated Explorer dock, ordinary side pane, per-source placement, drag/new-tab/diff tabs và tablet dock.                 |
| `v0.6.0` desktop chrome      | `MERGE`                 | Window controls riêng cho Windows/Linux qua shared chrome contract.                                                       |
| `v0.6.0` OpenCode            | `MERGE`                 | Chờ authoritative `server.connected`, cho initial SSE recovery một lần và giữ prompt fail-closed khi provider chưa ready. |
| Upstream package publication | `REJECT AS-IS`          | Downstream packages tiếp tục private, internal links dùng `*`, không publish dưới upstream npm scope.                     |
| `upstream/main` sau tag      | `DEFER`                 | Không dùng commit ngoài stable tag làm merge input.                                                                       |

Primary sources:

- [Release v0.6.0](https://github.com/getpaseo/paseo/releases/tag/v0.6.0)
- [Explorer pane host #3826](https://github.com/getpaseo/paseo/pull/3826)
- [OpenCode initial stream recovery #3814](https://github.com/getpaseo/paseo/pull/3814)
- [OpenCode authoritative readiness #3821](https://github.com/getpaseo/paseo/pull/3821)

## Downstream ownership

Merge simulation trên exact `.43` snapshot có 46 path overlap và 25 textual conflicts. Chín conflict
thuộc App/E2E; phần còn lại là docs, version, lockfile và Nix hash.

- Explorer sidebar và ordinary side pane nhận upstream làm owner. Hidden Side-panel lifecycle cũ bị
  gỡ; persisted `explorer` identifiers chỉ còn compatibility contract.
- Topology giữ downstream ownership và đăng ký `main` host; không ép graph vào Explorer dock.
- Project Issues, role-bound workspace creation, Workspace Protocol admission và assignment envelope
  được giữ trong các caller đã đổi theo upstream placement API.
- Plugin panel nhận host/location contract upstream; target-aware location vẫn quyết định panel có thể
  nằm ở workspace hay Explorer.
- Foundation role binding, no-write enforcement, Room/Council scope và receipts, Beads Central,
  trusted Semble và portable updater giữ downstream ownership. Không path nào trong các authority
  contract này được resolve wholesale bằng `ours` hoặc `theirs`.
- E2E dùng `spawnTsx`/process-tree cleanup cross-platform của upstream, đồng thời giữ isolated Beads
  sidecar, retrying temp cleanup và `preserveHome` semantics downstream.

## Gates

Source acceptance yêu cầu zero unmerged path, exact two-parent merge, focused Explorer/layout/settings,
Topology, plugin-host và OpenCode tests, all-workspace typecheck/lint/format, cùng lockfile/Nix readback.

Installed acceptance là gate riêng: fresh idle readback, `./scripts/local-stack.sh --apply`, exact source
fingerprint, CLI/daemon `0.6.0-paseo.44`, healthy `/api/health`, WebUI HTTP success, Beads Central
readback và browser journey cho Explorer plus downstream role/Room/Council surfaces. Không suy ra live
PASS từ source hoặc artifact.
