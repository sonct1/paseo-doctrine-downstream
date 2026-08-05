# Paseo Foundation — Operating Rules

## Ngôn ngữ

Documentation mới hoặc chỉnh material viết bằng tiếng Việt. Giữ commands, identifiers, paths, hashes, provider/model names, URLs và exact error text bằng English khi dịch làm giảm độ chính xác.

## Nguồn và thứ tự áp dụng

1. Current Human instruction/lease.
2. [`references/demonthorn-agent-orchestration-deep-dive.md`](references/demonthorn-agent-orchestration-deep-dive.md) — current orchestration doctrine.
3. [`docs/ROLE_CONTRACTS.md`](docs/ROLE_CONTRACTS.md) và [`WORKSPACE_PROTOCOL.md`](WORKSPACE_PROTOCOL.md).
4. Current repository bytes và reproduced evidence.
5. [`references/giao-an-herdr-first-edition.md`](references/giao-an-herdr-first-edition.md),
   [PDF First edition](references/Gi%C3%A1o%20%C3%81n%20Herdr%20-%20First%20edition.pdf)
   và historical records trong old workspace — extended evidence để audit, không override
   current Human decision, Deep Dive hoặc current source.

Khi conflict material, đọc exact source. Memory, status, provider ID, runtime capability hoặc historical plan không tự cấp authority.

## Instruction và authority

- **Role profile:** identity và universal role invariants.
- **Workspace Protocol:** một policy tactics riêng cho mỗi repository về topology, ownership, routing, review và evidence.
- **Assignment:** bounded objective với exact lease, scope, handback và stop condition.

Workspace Protocol là repo-specific delta nhỏ, mặc định khoảng mười semantic clauses; không lặp
universal role invariants, `AGENTS.md` hay one-task details. Provider/model/effort override chỉ sống
trong bounded assignment với reason, scope và expiry, không mutate standing role profile.

Lead là execution reader duy nhất của full Workspace Protocol và phải đọc trước orchestration. Supervisor chỉ inspect/create/audit/update khi có governance mandate; Peer không đọc full file mà chỉ nhận relevant constraints trong assignment.

Paseo là delegation/lifecycle plane duy nhất; Codex-native và Claude-native agents bị disable. Runtime `full-access` chỉ là capability, không mở rộng lease, ownership, external effects hoặc acceptance authority. Base/generated Codex profiles phải giữ `multi_agent=false`, `multi_agent_v2=false`; role profiles còn có `agents.enabled=false`.

Engineering đi theo Human → Lead → Peer. Supervisor đứng ngoài để quan sát orchestration và không bypass Lead trong ordinary work; exact Human recovery lease chỉ cho phép bounded stop/freeze hoặc decision relay theo [`docs/ROLE_CONTRACTS.md`](docs/ROLE_CONTRACTS.md). Mỗi moving/coupled scope chỉ có một write Owner.

Không restart daemon hoặc đổi global/runtime activation ngoài explicit Human approval.

## Simplicity và evidence

Chọn smallest useful topology. Trước abstraction, service, patch hoặc ceremony mới, nêu reproduced problem, owning layer và vì sao deletion, native Paseo, config, convention hoặc smaller prototype chưa đủ.

Evidence phải proportional: Git identity/diff và focused checks thường đủ; hash chỉ dùng khi Git không đủ hoặc risk cụ thể cần. Status, notification, silence và test pass không tự là acceptance.
