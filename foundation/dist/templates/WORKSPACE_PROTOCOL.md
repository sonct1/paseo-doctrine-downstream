# Workspace Protocol

<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 2 -->

- identity: `{{REQUIRED: owner; version; applies_to; review trigger — the evidence that would change this file, not a calendar date}}`
- project risk/protected areas: `{{REQUIRED: risk class, plus the areas where a mistake is expensive or hard to reverse. `unclassified` is an honest answer for a repository nobody has characterised yet}}`
- default topology: `{{REQUIRED: when Lead works directly, and what has to be true before adding a Peer, Reviewer or Supervisor}}`
- ownership/hotspots: `{{REQUIRED: the one-writer rule for moving scopes, and which surfaces are coupled so that changing one silently changes another}}`
- routing defaults: `{{REQUIRED: how provider/model/effort get discovered and pinned; every task route carries a reason, a scope and an expiry, and nothing falls back silently}}`
- issue tracker: Beads Central is the mandatory durable issue/work graph for Lead, Peer and Supervisor. Every role calls `beads_status` when an assignment starts, reads the relevant issues before acting, and records an authoritative readback at material handoff. If Central is unavailable, mutation is `BLOCKED` and issue state stays `UNKNOWN`; non-mutating inspection may continue, and there is no fallback to native `bd` or a second tracker. Lead creates and updates the graph and closes only after a verdict; Peer claims and updates exactly the granted issue and records discovered work with `discoveredFrom`; Supervisor is read-only.
- existing harness: `{{REQUIRED: what already governs this repository — AGENTS.md, CONTRIBUTING, CI gates, review conventions — and which of them this protocol defers to. Write `none` only after looking}}`
- project policy: `{{REQUIRED: none | exact package + version + scope + authority + conflict rule}}`
- review/evidence: `{{REQUIRED: the proportionate checks, what triggers an independent review, and who owns acceptance}}`
- escalation/Human decisions: `{{REQUIRED: how REOPEN, DEPENDENCY and BLOCKED travel, and which decisions the Human keeps}}`
- repository exceptions/anti-patterns: `{{REQUIRED: material local exceptions, or `none`}}`
