# Upstream Paseo v0.5.0 stable integration

## Bottom line

- Recommendation: merge exact annotated tag `v0.5.0`, peeled commit
  `b8a31034ca36301067edadc2d622f42f4a4f7a37`, bằng một semantic two-parent merge trên branch riêng.
- Không dùng `v0.5.0-beta.*`, upstream `main`, `next` hoặc tag mới hơn làm integration input.
- Resolve theo owner contract; không lấy nguyên file bằng `ours` hoặc `theirs` ở protocol, agent,
  profile, pane, plugin, skill, Hub hoặc release paths.
- Confidence: 94%. Remaining uncertainty nằm ở 50 conflict paths và live cross-platform behavior,
  được xử lý bằng focused gates, activation readback và in-app Browser E2E.

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

## Acceptance gates

- Conflict ledger reaches zero with every resolution mapped to an owner train.
- Focused tests for every changed conflict owner; no full local suite.
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
