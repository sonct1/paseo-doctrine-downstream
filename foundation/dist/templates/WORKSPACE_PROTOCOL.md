# Workspace Protocol của repository

<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 3 -->

- identity: `{{REQUIRED: owner; version; last_reviewed; applies_to}}`
- project risk/protected areas: `{{REQUIRED: risk class, material risks và protected areas}}`
- default topology: `{{REQUIRED: Lead-direct tiny path và smallest useful Peer/Supervisor triggers}}`
- ownership/hotspots: `{{REQUIRED: write Owner rule và coupled/shared surfaces}}`
- routing defaults: `{{REQUIRED: discovery/pinning principles; task route phải có reason, scope và expiry}}`
- issue tracker: Beads Central là durable issue/work graph bắt buộc cho Lead, Peer và Supervisor. Mỗi role gọi `beads_status` khi bắt đầu assignment, đọc issue liên quan trước action và ghi authoritative readback ở material handoff; Central unavailable thì `BLOCKED`, không fallback native `bd`/tracker khác. Lead create/update và chỉ close sau verdict; Peer claim/update exact granted issue và dùng `discoveredFrom`; Supervisor read-only.
- project policy: `{{REQUIRED: none | exact package + version + scope + authority + conflict rule}}`
- review/evidence: `{{REQUIRED: proportional checks, review triggers và acceptance owner}}`
- escalation/Human decisions: `{{REQUIRED: REOPEN/DEPENDENCY/BLOCKED route và retained decisions}}`
- repository exceptions/anti-patterns: `{{REQUIRED: material local exceptions hoặc none}}`
