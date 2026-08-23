# Upstream Paseo v0.5.0 stable integration

## Bottom line

- Result: exact annotated tag `v0.5.0`, peeled commit
  `b8a31034ca36301067edadc2d622f42f4a4f7a37`, đã được semantic two-parent merge tại
  `081abc7b46040eb410c8ac5cc84370726882ad58`.
- Không dùng `v0.5.0-beta.*`, upstream `main`, `next` hoặc tag mới hơn làm integration input.
- Resolve theo owner contract; không lấy nguyên file bằng `ours` hoặc `theirs` ở protocol, agent,
  profile, pane, plugin, skill, Hub hoặc release paths.
- 50 conflict paths đã closeout về zero unmerged path. Cross-platform behavior ngoài local macOS và
  post-stable upstream vẫn nằm ngoài claim của job này.

Đây là đường nhẹ nhất còn giữ đủ provenance. Rebase sẽ replay 194 downstream commits và lặp conflict.
Selective cherry-pick phải reconstruct dependency của 181 stable commits và dễ bỏ final-release fix.

## Repo snapshot

- `Local`: downstream baseline là clean commit
  `00996c3cdc9da4f8c02abfab788bed8358ce8d80`, version `0.4.0-paseo.31`.
- `Upstream`: merge-base là `ab274d635e17c82efa3f74e842d59f211374b8c0`; stable delta có 181 commits,
  933 files, 57,678 insertions và 19,962 deletions.
- `Local`: downstream có 194 commits ngoài merge-base; fresh `git merge-tree` báo 50 conflict paths.
- `Local`: monorepo npm/TypeScript chứa daemon, protocol, WebUI, CLI, relay, desktop, plugin SDK và
  imported Foundation distribution. Node `v26.5.0`, npm `11.17.0`.
- `Upstream`: `v0.5.1` đã tồn tại tại
  `f517493591a7b4072aa30ee48db13c1a51495103`; nó có 4 commits/21 files sau `v0.5.0` và nằm ngoài
  authority của integration này.

## Requested outcome

Success nghĩa là final tree nhận stable `v0.5.0` behavior đã approve, giữ Foundation doctrine và
downstream additions, ghi rõ semantic nào không nhận, rồi build/install/activate exact clean commit.
Sau activation phải chạy live role/tool canaries và một Browser journey bằng prompt tự nhiên theo giọng
Human cho Supervisor, Lead, Peer, Agent Profile, Role Profile, Room và Council.

## Evidence ledger

- `Local`: `docs/foundation-product.md` yêu cầu exact upstream commit, semantic resolution, tagged
  Foundation import và live role qualification.
- `Local`: `docs/protocol-compatibility.md` yêu cầu additive optional wire fields và old-app/new-daemon
  compatibility.
- `Local`: current Foundation overlays sở hữu role binding, no-write enforcement, Beads Central,
  Supervisor/Lead/Peer, Room/Council và durable timeline provenance.
- `Upstream`: stable final tree thêm daemon-owned skills, plugin scope/themes, Side/New-tab panes,
  profiles/tracks, steering fixes, exact SDK pins, Hub starter và timeline-memory change.
- `Inference`: stable tag phải là Git parent để giữ provenance, nhưng acceptance được quyết định bởi
  final semantic tree và downstream gates, không bởi merge ancestry.

## Resolution policy

1. Merge exact `v0.5.0^{}` với `--no-commit` trên `codex/integrate-upstream-v0.5.0`.
2. Resolve generated versions, lockfile và Nix từ downstream graph sau semantic code resolution.
3. Union additive protocol fields; giữ role/assignment/Council/Peer and no-write contracts.
4. Nhận daemon-owned skill management nhưng giữ Product Foundation bundle là source of truth và preserve
   user files.
5. Nhận canonical `@getpaseo/plugin`, themes/panels/RPC behavior và migrate downstream imports/tests.
6. Nhận final pane/profile/steering/project/provider/UI behavior với downstream role/profile extensions.
7. Giữ durable timeline store; không nhận destructive cleanup hoặc restart identity loss của #3647.
8. Không nhận guided Hub patch as-is nếu agent vẫn unbound hoặc writer thay nguyên `.paseo/`; giữ current
   downstream path và defer governed cross-repo adaptation.
9. Commit merge trước; version/changelog/lock/Nix release metadata là commit riêng.

## Not-merged ledger

Ledger này được cập nhật trong lúc resolve; mỗi entry phải có source, disposition, lý do và reopen gate.

| Source                                                 | Disposition                 | Reason                                                                          | Reopen gate                                                                      |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `v0.5.0-beta.1` … `v0.5.0-beta.5` refs                 | `NOT USED AS INPUT`         | Stable final tag là approved boundary; interim beta snapshots không phải source | Không reopen trong job này                                                       |
| `v0.5.1` and every commit after `b8a31034`             | `NOT MERGED — OUT OF SCOPE` | Newer than Human-approved source                                                | Fresh release assessment và explicit Human approval                              |
| #3647 production timeline-memory/destructive cleanup   | `REJECT AS-IS`              | Mất durable restart provenance và xóa `$PASEO_HOME/agent-timelines`             | Transactional persistence, migration/backup, compaction và restart tests         |
| #3651/#3657/#3677 unbound/destructive guided Hub shape | `DEFER AS-IS`               | Hub wire thiếu role/assignment/admission; writer owns whole `.paseo/`           | Cross-repo authority receipt, file-scoped writer, capability gate và live canary |
| Upstream package versions, lockfile and Nix hash       | `REGENERATE`                | Downstream package graph và release identity khác                               | Regenerate after final semantic tree                                             |
| Guided Hub provider/connection/resource discovery      | `MERGE AS DORMANT INPUT`    | Hữu ích cho adaptation nhưng không tự cấp authority                             | Chỉ gọi từ starter sau capability negotiation                                    |
| Guided Hub whole-directory `.paseo/` writer            | `REJECT AS-IS`              | Có thể replace user-owned bundle và không có file-scoped ownership receipt      | Atomic file-scoped plan, per-file diff/approval và rollback receipt              |
| Automatic starter continuation sau interactive login   | `NOT ACTIVATED`             | Login authority không đồng nghĩa daemon enrollment hoặc workflow deployment     | Cùng Foundation authority-contract capability gate với `hub init`                |
| Stable raw ACP catalog ngoài Cursor                    | `MERGE METADATA; DEFER UI`  | Chưa qualification role/tool/no-write trên downstream                           | Exact provider canary, capability receipt và product approval                    |
| MiniMax Code, fast-agent và Hermes install journey     | `DEFER`                     | Raw metadata được giữ; Add Provider vẫn Cursor-only                             | Provider-specific install + role/tool/no-write E2E                               |
| Pre-rename `@paseo/plugin` SDK scope                   | `COMPAT ONLY`               | Không còn là canonical package/import/release identity                          | Xóa alias khi support window kết thúc và plugin corpus không còn dùng            |
| Upstream plugin publication                            | `NOT MERGED`                | Downstream không được publish package dưới `@getpaseo`                          | Explicit namespace/release authority mới từ Human                                |
| Upstream `CHANGELOG.md` release prose                  | `NOT COPIED`                | Downstream cần release note theo exact merged/adapted/deferred tree             | Synthesize downstream entry từ ledger đã verify                                  |
| Desktop-owned global skill installer/files             | `SUPERSEDED`                | Stable chuyển ownership sang daemon host controller                             | Không reopen; migration chỉ giữ user selection compatibility                     |
| Nix desktop top-level `skills/` copy                   | `NOT RETAINED`              | Daemon-owned skill lifecycle là canonical owner                                 | Chỉ reopen nếu một packaged runtime consumer được reproduce là thiếu asset       |
| Downstream Foundation doctrine, roles, Room/Council    | `RETAIN`                    | Là Foundation owner bytes, không có upstream replacement tương đương            | Chỉ đổi qua Foundation doctrine/release process                                  |

### Post-tag ACP registry drift không merge

`npm run acp:version-drift:check` ngày 2026-08-24 thấy 13 registry versions mới hơn stable catalog.
Đây không phải bytes của `v0.5.0`; nhận chúng trong job này sẽ phá exact-source boundary. Downstream
`acp:pin-consistency:check` vẫn pass với zero internal drift.

| Provider      | Stable pin retained            | Registry version observed | Disposition             |
| ------------- | ------------------------------ | ------------------------- | ----------------------- |
| Auggie        | `@augmentcode/auggie@0.35.0`   | `0.36.0`                  | `NOT MERGED — POST-TAG` |
| Cline         | `cline@3.0.55`                 | `3.0.57`                  | `NOT MERGED — POST-TAG` |
| DeepAgents    | `deepagents-acp@0.1.25`        | `0.1.27`                  | `NOT MERGED — POST-TAG` |
| DimCode       | `dimcode@0.3.13`               | `0.3.18`                  | `NOT MERGED — POST-TAG` |
| Dirac         | `dirac-cli@0.4.36`             | `0.4.37`                  | `NOT MERGED — POST-TAG` |
| Factory Droid | `droid@0.197.0`                | `0.202.0`                 | `NOT MERGED — POST-TAG` |
| fast-agent    | `fast-agent-acp==0.9.22`       | `0.10.9`                  | `NOT MERGED — POST-TAG` |
| Gemini CLI    | `@google/gemini-cli@0.55.1`    | `0.56.0`                  | `NOT MERGED — POST-TAG` |
| GLM Agent     | `glm-acp-agent@1.5.0`          | `1.6.0`                   | `NOT MERGED — POST-TAG` |
| MiniMax Code  | `@minimax-ai/code@0.1.2`       | `0.2.3`                   | `NOT MERGED — POST-TAG` |
| Nova          | `@compass-ai/nova@1.1.35`      | `1.1.37`                  | `NOT MERGED — POST-TAG` |
| Qoder         | `@qoder-ai/qodercli@1.1.23`    | `1.1.28`                  | `NOT MERGED — POST-TAG` |
| Qwen Code     | `@qwen-code/qwen-code@0.21.13` | `0.22.0`                  | `NOT MERGED — POST-TAG` |

Reopen các pin này bằng một ACP maintenance assessment riêng, qualification provider-specific và Human
approval; không gộp vào stable integration provenance.

## Merged / adapted closeout

| Surface                                | Result                  | Downstream adaptation                                                                                             |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Protocol, bootstrap, WebSocket, config | `MERGE WITH ADAPTATION` | Union stable optional fields với role binding, assignment, Council, Workspace Protocol revision và MCP admission  |
| Durable timeline                       | `RETAIN + ADAPT`        | Nhận snapshot/reconciliation interfaces nhưng giữ persistent store; không xóa timeline khi startup                |
| Profiles, panes, workspace UI          | `MERGE WITH ADAPTATION` | Nhận stable editor/tabs/panes/tracks và giữ peer subrole, role intent, Topology, Issues, protocol/admission draft |
| Plugin SDK/runtime                     | `MERGE WITH ADAPTATION` | Canonical private `@getpaseo/plugin`, giữ scope cũ chỉ như compatibility alias, không publish                     |
| Orchestration skills                   | `MERGE WITH ADAPTATION` | Daemon là owner; migrate selection cũ, preserve user files, không copy/install trùng từ desktop/Nix               |
| Hub discovery                          | `MERGE DORMANT`         | Giữ provider/connection/resource helpers nhưng public init/continuation fail closed trước mọi side effect         |
| Hub starter deployment                 | `DEFER`                 | Chưa có role/assignment/admission revision/file ownership receipt nên không tạo generic agent hoặc workflow       |
| ACP catalog                            | `MERGE METADATA`        | Giữ exact command/version/icon metadata; Product route vẫn chỉ hiện provider đã downstream qualify                |
| Codex role resume                      | `MERGE WITH FIX`        | Runtime role/MCP config sống qua unarchive; role-tool gate không native-resume cùng thread lần hai                |
| Foundation doctrine/components         | `RETAIN`                | Supervisor, Lead, Peer, Room, Council, Beads Central, Topology và release authority tiếp tục là downstream owner  |

## Acceptance gates

- Conflict ledger reaches zero with every resolution mapped to an owner train.
- Focused tests cho từng conflict owner và full local suite cho distribution surfaces được ship.
- `npm run format`, `npm run format:check`, `npm run typecheck`, `npm run lint`, release guards and
  downstream Foundation validators pass.
- Version is bumped once after code merge and internal workspace versions, lockfile and Nix hash agree.
- Fresh authoritative idle readback shows zero running/starting agents and zero active workspace scripts.
- `./scripts/local-stack.sh --apply` succeeds; no-flag readback proves exact commit/fingerprint.
- CLI, daemon, WebUI, health and Beads Central endpoints pass installed-runtime readback.
- Live Supervisor/Lead/Peer/Room/Council/role-profile/agent-profile canaries produce native receipts.
- In-app Browser completes full human-style journeys and captures failures with exact route, prompt and
  daemon evidence.

## Source pack

- Local: `CLAUDE.md`, `docs/foundation-product.md`, `docs/release.md`,
  `docs/protocol-compatibility.md`, `docs/native-role-binding.md`, `docs/rooms.md`, `docs/skill-system.md`,
  `docs/testing.md`, `docs/qa.md`.
- Upstream: exact Git tag `v0.5.0`, release notes and source commits reachable from that tag.
- Prior assessment: `paseo-foundation/docs/research/paseo-upstream-v0.5.0-integration-assessment-2026-08-23.md`.
