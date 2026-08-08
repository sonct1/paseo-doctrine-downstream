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
- **Workspace Protocol:** mandatory thin repository contract; baseline có thể khai báo chưa có delta riêng.
- **Assignment:** bounded objective với exact lease, scope, handback và stop condition.

Mỗi greenfield hoặc brownfield repository dùng SLP có target state là root `WORKSPACE_PROTOCOL.md`. File
giữ khoảng mười semantic clauses và không lặp universal role invariants, `AGENTS.md` hay one-task details;
repository chưa có delta riêng dùng thin baseline với các giá trị `none`/`unclassified` minh bạch. Khi
thiếu file, Paseo phân loại `bootstrap-required` và Human review/bootstrap trên WebUI. Default admission
yêu cầu protocol hợp lệ trước new material delegation hoặc protected/mutating work; exact Human exception
chỉ có thể nới cho bounded read-only inspection, bootstrap hoặc recovery với reason, scope và expiry.
Invalid/unreadable file fail closed tới correction path; existing active work không bị auto-terminate.
CLI/MCP chỉ là automation surface cho AI agent, không phải setup path Human phải gõ hoặc copy/paste.

Lead là execution reader duy nhất và đọc full file trước orchestration. Supervisor chỉ inspect/create/audit/update khi có governance mandate; Peer không đọc full file mà chỉ nhận relevant constraints trong assignment.

Paseo là delegation/lifecycle plane duy nhất; Codex-native và Claude-native agents bị disable. Runtime `full-access` chỉ là capability, không mở rộng lease, ownership, external effects hoặc acceptance authority. Base/generated Codex profiles phải giữ `multi_agent=false`, `multi_agent_v2=false`; role profiles còn có `agents.enabled=false`.

Engineering đi theo Human → Lead; Lead có thể làm trực tiếp exact tiny task khi applicable Human/repo
binding cho phép và transfer không thêm independent judgment; work có material uncertainty/risk hoặc
thật sự cần independent judgment mới route qua Peer. Supervisor đứng ngoài để
quan sát orchestration và không bypass Lead trong ordinary work; exact Human recovery lease chỉ cho
phép bounded stop/freeze hoặc decision relay theo [`docs/ROLE_CONTRACTS.md`](docs/ROLE_CONTRACTS.md).
Mỗi moving/coupled scope chỉ có một write Owner.

Không restart daemon hoặc đổi global/runtime activation ngoài explicit Human approval.

## Simplicity và evidence

Chọn smallest useful topology. Trước abstraction, service, patch hoặc ceremony mới, nêu reproduced problem, owning layer và vì sao deletion, native Paseo, config, convention hoặc smaller prototype chưa đủ.

Evidence phải proportional: Git identity/diff và focused checks thường đủ; hash chỉ dùng khi Git không đủ hoặc risk cụ thể cần. Status, notification, silence và test pass không tự là acceptance.
