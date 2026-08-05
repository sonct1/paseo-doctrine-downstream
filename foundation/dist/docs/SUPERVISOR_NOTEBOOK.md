# Supervisor Notebook — contract và template

- Trạng thái: current Foundation contract/template
- Owner: Human/project owner
- Phạm vi: durable learning về orchestration behavior qua các Paseo workspace; không phải product truth

## Provenance

| Nhãn | Nguồn | Phần được giữ |
|---|---|---|
| `DIRECT_ARTIFACT` | [Demonthorn Supervisor profile](../references/demonthorn-profiles-refs/supervisor.config.toml) | durable cross-workspace record; chỉ thêm evidence novel/materially stronger; aggregate theo pattern; Supervisor không tự patch protocol khi chỉ monitoring |
| `CURRENT_DOCTRINE_SYNTHESIS` | [Deep Dive — Supervisor notebook](../references/demonthorn-agent-orchestration-deep-dive.md#supervisor-notebook) | causal context, evidence, open question, recovery và protocol candidate |
| `CURRENT_HUMAN_DECISION` | Human instruction ngày `2026-08-03` | record schema, lifecycle, authority boundary và yêu cầu giữ unsupported mechanism là `unknown`/hypothesis |
| `HISTORICAL` | `/Users/iznogoud/Desktop/Projects-AI/paseo-workflow-project/SUPERVISOR_NOTEBOOK.md` | lineage only; không copy project-decision/task-tracker shape thành current contract |

Catalog provenance rộng hơn nằm tại [Demonthorn supplied materials catalog](../references/demonthorn-supplied-materials-catalog.md#supervisor-notebook-và-continuous-optimization). `DIRECT_ARTIFACT`, `CURRENT_DOCTRINE_SYNTHESIS` và current Human decision không phải ba authority ngang nhau; source precedence vẫn theo `AGENTS.md`.

## Contract

Supervisor Notebook là durable organizational memory về coordination failure, recurring anti-pattern, recovery và protocol experiment. Nó giống lab notebook có causal context, không phải:

- transcript hoặc telemetry dump;
- task tracker, product bug backlog hay project decision log;
- repository evidence, engineering acceptance hoặc authority source;
- nơi lưu secret, credential, raw chain-of-thought hoặc suy đoán được viết như fact.

Chỉ thêm record khi episode novel, material hoặc cung cấp evidence mạnh hơn cho một pattern đã có. Nhiều occurrence giống nhau được aggregate vào cùng pattern; không tạo một entry cho mỗi symptom hoặc mỗi healthy task. Observation tách khỏi `Suspected mechanism`; mechanism chưa được chứng minh phải giữ là `unknown` hoặc hypothesis.

## Record tối thiểu

```text
Pattern / episode:
Scope + date:
Observation:
Evidence:
Suspected mechanism: <hypothesis | unknown>
Impact/cost: <momentum | ownership | attention | quality | authority>
Question for Lead:
Recovery/intervention: <what happened; who held authority>
Outcome:
Pattern status: <one-off | repeated | durable | disproved>
Recommendation/protocol candidate: <smallest correction | none>
Escalation needed: <no | exact Human/Lead decision>
```

`Pattern status` chỉ là mô tả judgment hiện tại, không phải workflow state machine. Khi evidence mới bác hypothesis, preserve correction/disproof thay vì rewrite record như hypothesis cũ chưa từng tồn tại.

## Lifecycle

```text
concrete episode
  → Supervisor thu bounded evidence
  → hình thành causal hypothesis
  → hỏi Lead bằng open evidence-backed question
  → ghi recovery và outcome
  → aggregate nếu pattern tái diễn
  → đề xuất smallest profile/Workspace Protocol change
  → Human hoặc đúng authority approve/apply
  → đánh giá trên comparable workstream tiếp theo
```

Supervisor được observe, hỏi, ghi learning record và propose. Notebook không tự cho phép Supervisor direct Peer, sửa/review product, tự apply proposal, tự replace Lead hoặc accept engineering work. Một separate exact Human recovery lease có thể cho phép bounded `STOP`/`FREEZE` hoặc decision relay theo Role Contracts; authority đó đến từ Human binding, không đến từ notebook. Accepted project decision vẫn vào project decision source; rule đã được duyệt mới vào `WORKSPACE_PROTOCOL.md` hoặc standing role profile.

## Location và binding

Foundation không hard-code historical path `/root/.config/room-workflow/SUPERVISOR_NOTEBOOK.md`. Mỗi Supervisor binding phải chỉ ra một durable notebook location, scope và reporting target; không tạo per-session copy. File này là canonical contract/template, không phải database hoặc live cross-project ledger engine.
