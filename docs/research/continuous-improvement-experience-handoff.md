# Continuous Improvement Experience Handoff

Status: product proposal, not implementation guidance.

Scope: this note uses current local Paseo product/Foundation bytes plus first-party GitHub material from Hermes and Better Harness. It separates sourced facts from proposal and inference.

## Sourced facts: current Paseo and Foundation

### Current archive and lifecycle semantics

- Current agent persistence includes `lastStatus`, `requiresAttention`, `attentionReason`, and `archivedAt`. I did not find a persisted `accepted` or `acceptedAt` lifecycle field in the current agent record schema. Source: [packages/server/src/server/agent/agent-storage.ts](../../packages/server/src/server/agent/agent-storage.ts)
- In the current product, `finished` is an attention condition layered on top of `idle`, not a separate accepted or archived state. Terminal activity maps `working -> idle` into `attentionReason: finished` until focus clears. Source: [docs/terminal-activity.md](../terminal-activity.md)
- An agent can be `closed` without being archived. Closing releases runtime state while preserving the durable Paseo record. Source: [docs/agent-lifecycle.md](../agent-lifecycle.md)
- Archive is a separate global lifecycle mutation. `AgentManager.archiveAgent()` snapshots the session, writes `archivedAt`, normalizes `running` and `initializing` to `idle`, closes the runtime, and cascade-archives managed children. Sources: [docs/agent-lifecycle.md](../agent-lifecycle.md), [packages/server/src/server/agent/agent-manager.ts](../../packages/server/src/server/agent/agent-manager.ts), [packages/server/src/server/agent/agent-archive.ts](../../packages/server/src/server/agent/agent-archive.ts)
- Closing a root-agent tab still archives the agent. That means archived does not imply accepted. Source: [docs/agent-lifecycle.md](../agent-lifecycle.md)
- Auto-archive exists only on explicit lifecycle paths: `create_agent_request` may opt into `autoArchive` after its first terminal turn, loop workers may be created with archive behavior, and merge-driven workspace archive runs only when `autoArchiveAfterMerge` is enabled and its safety checks pass. None of these paths represents engineering acceptance. Sources: [docs/agent-lifecycle.md](../agent-lifecycle.md), [packages/server/src/server/agent/create-agent-lifecycle-dispatch.ts](../../packages/server/src/server/agent/create-agent-lifecycle-dispatch.ts), [packages/server/src/server/auto-archive-on-merge/archive-if-safe.ts](../../packages/server/src/server/auto-archive-on-merge/archive-if-safe.ts)
- The subagent-track action **Archive finished** is presentation-only for provider-owned rows in the current app session; it does not archive managed Paseo agents or mutate native provider state. Source: [docs/agent-lifecycle.md](../agent-lifecycle.md)

### Current authority model

- Lead owns outcome, topology, Peer routing, integration, and engineering acceptance inside the Human lease. Peer does not accept work. Supervisor does not accept engineering work and replacement remains Human-authorized. Source: [packages/server/src/server/agent/foundation-role-definitions.ts](../../packages/server/src/server/agent/foundation-role-definitions.ts)
- Foundation doctrine treats `full-access` as runtime capability, not write, replacement, or acceptance authority. Source: [packages/server/src/server/agent/foundation-role-definitions.ts](../../packages/server/src/server/agent/foundation-role-definitions.ts), [docs/native-role-binding.md](../native-role-binding.md)
- Current role binding separates standing role profile, optional repository `WORKSPACE_PROTOCOL.md`, and bounded assignment. Full protocol binds to Lead; Peer receives extracted constraints only; Supervisor reads full protocol only under an exact governance mandate. Source: [foundation/dist/docs/ROLE_INSTRUCTION_BINDING.md](../../foundation/dist/docs/ROLE_INSTRUCTION_BINDING.md)
- The Control Workspace template already establishes a redacted, one-writer notebook with no engineering acceptance authority. Source: [control-workspace/template/WORKSPACE_PROTOCOL.md](../../control-workspace/template/WORKSPACE_PROTOCOL.md), [control-workspace/template/SUPERVISOR_NOTEBOOK.md](../../control-workspace/template/SUPERVISOR_NOTEBOOK.md)
- The imported Demonthorn deep dive says Supervisor records causal context in a notebook, proposes profile/protocol changes only when the pattern is durable, and should propose a bounded handoff or new Lead instead of silently replacing one. It also says Supervisor is not a second Lead. Source: [foundation/dist/references/demonthorn-agent-orchestration-deep-dive.md](../../foundation/dist/references/demonthorn-agent-orchestration-deep-dive.md)

## Sourced facts: first-party external comparison points

### Hermes

- `NousResearch/hermes-agent` describes Hermes as keeping memory, searching prior conversations, and creating skills from experience so the agent improves during use. Source: <https://github.com/NousResearch/hermes-agent>
- `NousResearch/hermes-agent-self-evolution` describes a separate optimization loop that reads the current prompt or skill, generates evaluation data from execution traces, optimizes variants, and emits the best result back toward `hermes-agent`. Its `PLAN.md` describes a later continuous-improvement phase rather than immediate automatic in-place mutation. Sources: <https://github.com/NousResearch/hermes-agent-self-evolution>, <https://github.com/NousResearch/hermes-agent-self-evolution/blob/main/PLAN.md>

### Better Harness

- `QoderAI/better-harness` describes a workflow that turns project and session data into ranked problems, candidate fixes, and verifiable next steps while keeping missing evidence explicit. Its docs distinguish the history/trend view from causal proof. Source: <https://github.com/QoderAI/better-harness>
- Better Harness also documents independent evidence domains that stay separate until unified analysis and a plugin lifecycle that plans and validates changes rather than silently applying them as ambient learning. Sources: <https://github.com/QoderAI/better-harness/blob/main/docs/overview.md>, <https://github.com/QoderAI/better-harness/blob/main/docs/evidence.md>, <https://github.com/QoderAI/better-harness/blob/main/docs/plugin-lifecycle.md>

## Owner-provided design input

This section paraphrases the current Human brief plus local Demonthorn-aligned expectations. It is design input, not an externally verified fact set.

- The system should collect Lead and Peer pain, failed approaches, successes, provider-personality observations, and candidate instruction or protocol improvements, but never auto-apply them.
- Human should review accumulated evidence after days of operation before any doctrine or instruction merge.
- Experience handoff should happen only between adjacent Leads. If Supervisor detects context dilution, it should first let the current Lead finish its currently bounded work or reach a stable stop point, then require a handoff before a successor starts. No arbitrary mid-scope preemption.
- A continuous collector may exist, but it must hold no acceptance authority and no instruction-write authority.

## Proposal

### 1. Do not overload archive with acceptance

Because current Paseo has `idle`, `finished` attention, `closed`, and `archivedAt`, but no durable accepted lifecycle state, the proposal should not reinterpret existing archive behavior as acceptance.

Proposed rule:

- `finished` means "the runtime reported an idle/turn-complete condition that may need review."
- `archived` means "the runtime and durable record were lifecycle-closed."
- `accepted` remains an explicit governance artifact outside agent lifecycle until Paseo deliberately introduces a first-class acceptance receipt.

Implication:

- The lesson system should harvest from explicit handbacks, explicit Lead decisions, explicit Supervisor observations, or explicit Human review batches.
- It should not harvest on every `idle`, `finished`, or `archivedAt` transition.

### 2. Introduce an acceptance-gated lesson ledger

The product should add a durable ledger for operating experience, but the ledger should be evidence-first and append-only.

Proposed entry types:

- `pain_point`
- `failed_approach`
- `successful_pattern`
- `provider_personality_observation`
- `candidate_instruction_change`
- `candidate_protocol_change`
- `handoff_risk`
- `later_effect_result`

Proposed entry shape:

- `entryId`
- `capturedAt`
- `workspaceId`
- `projectId` or repo root
- `role`: `supervisor | lead | peer | collector`
- `providerRoute`: provider plus model if known
- `episodeKind`: accepted, rejected, blocked, handoff, reopen, repeat-friction
- `summary`
- `redactedEvidenceRefs`: timeline ids, agent ids, workspace ids, commit ids, file paths, command receipts
- `observation`
- `causalHypothesis`
- `impact`
- `confidence`
- `scope`: `provider_specific | role_global | repo_local | environment_local`
- `candidateChange`
- `contraryEvidence`
- `reviewState`

Proposed lesson lifecycle:

1. `captured`
2. `redacted`
3. `corroborated` or `quarantined`
4. `review_queued`
5. `accepted_for_experiment`, `rejected`, `expired`, or `superseded`
6. `later_effect_measured`
7. `eligible_for_merge`

Key rule:

- `eligible_for_merge` is still not `merged`. Merge remains a separate Human-owned decision.

### 3. Use review batches with cooling time

Borrow the useful part of Hermes and Better Harness without copying their stronger self-mutation posture.

Proposed operating model:

- The ledger accumulates entries continuously.
- A review batch opens only after a cooling window measured in days, not minutes.
- The batch groups repeated patterns, contradictions, and later-effect evidence.
- The batch can recommend one of three outcomes:
  - no action
  - bounded experiment
  - doctrine or instruction patch candidate

Why this shape:

- Hermes is explicitly interested in self-improvement and optimized prompt or skill variants.
- Better Harness explicitly separates evidence gathering from unified analysis and action planning.
- Paseo doctrine is stricter about authority, so the product should stop at reviewable proposals rather than auto-apply.

### 4. Add adjacent-Lead experience handoff

The handoff should be a first-class artifact, not a free-form chat summary.

Proposed handoff triggers:

- Supervisor observes context dilution, repeated forgotten decisions, repeated reopen on already-settled evidence, or widening mismatch between current task and retained context.
- Lead requests handoff voluntarily.
- Human orders handoff.

Proposed handoff constraints:

- No arbitrary mid-scope preemption.
- Supervisor does not seize implementation ownership.
- Current Lead should finish the currently bounded unit of work or pause at an explicit stop point.
- Successor Lead starts only after the handoff packet exists and the replacement path is explicitly authorized.

Proposed handoff packet:

- current objective and stop condition
- current leases and mutation owners
- accepted decisions that must not be silently reopened
- open hypotheses and unknowns
- failed approaches already tried
- successful patterns worth preserving
- active risks and blockers
- evidence index
- exact point where successor should resume
- explicit "do not assume" list

Proposed handoff states:

1. `active_lead`
2. `handoff_requested`
3. `stabilizing_current_scope`
4. `handoff_packet_ready`
5. `successor_authorized`
6. `successor_active`
7. `predecessor_archivable` or `predecessor_retained_for_readback`

### 5. Add a doctrine-grounded collector, but keep it powerless

Assessment: an independent collector is useful if and only if it is narrow, append-only, and authority-free.

Recommended role for the collector:

- Continuously gather redacted evidence receipts across Supervisor, Lead, and Peer episodes.
- Normalize them into candidate ledger entries.
- Deduplicate repeated patterns.
- Attach contradiction and confidence fields.

The collector should not:

- accept engineering work
- write or patch instructions
- merge protocol changes
- trigger handoff by itself
- replace Lead
- archive agents
- reinterpret `finished` or `archived` as accepted

Preferred product shape:

- a passive product facility or dedicated observer surface, not another owner in the engineering chain
- append-only into the ledger
- routed through Human and Lead review, not directly into active standing bytes

This keeps collection independent without creating a shadow governance plane.

### 6. Separate provider-specific learning from role-global learning

Not every lesson belongs in doctrine.

Proposed buckets:

- `provider_specific`: model behavior, route quirks, transport defects, prompt-shape sensitivities
- `role_global`: Lead, Peer, Supervisor interaction rules and authority boundaries
- `repo_local`: workspace protocol, repository instructions, project-specific review gates
- `environment_local`: secrets, quotas, machine drift, daemon state, service outages

Promotion rules:

- `provider_specific` lessons should default to provider docs, route notes, or provider-scoped profiles.
- `role_global` lessons are the only candidates for Foundation role-contract evolution.
- `repo_local` lessons belong in the repository protocol or project docs.
- `environment_local` lessons should normally expire unless they recur across episodes.

### 7. Privacy, retention, and anti-poisoning

The current Foundation and Control Workspace bytes already push toward redacted evidence and one-writer durable notes. The lesson system should preserve that posture.

Proposed privacy and redaction rules:

- No raw transcript storage in the ledger.
- No credentials, secret-bearing environment variables, or provider auth artifacts.
- Store redacted excerpts only when needed to understand the evidence.
- Keep stable pointers to canonical evidence rather than duplicating full content.

Proposed retention rules:

- Keep candidate lessons long enough to survive the cooling window and later-effect measurement.
- Keep rejected and superseded entries with their reason, so the system does not relearn the same bad change.
- Expire environment-local incidents unless they become repeated patterns.

Proposed anti-poisoning rules:

- One model's self-report is never enough.
- Require corroborating evidence from artifacts, command receipts, timeline state, or repeated episodes.
- Preserve contrary evidence next to the claim.
- Mark confidence and scope explicitly.
- Provider-personality observations must be bounded, situational, and falsifiable, not anthropomorphic permanent labels.
- No lesson is eligible for doctrine merge without later-effect evidence from at least one bounded experiment or repeated naturally observed episodes.

## Smallest staged experiment

The smallest safe experiment is manual and review-first.

Stage 1:

- One workspace.
- One Lead, one Peer, optional Supervisor.
- No collector automation yet.
- Human or Lead records ledger entries manually for 3 to 7 days.
- Entries are limited to explicit accepted handbacks, explicit blocked episodes, explicit failed approaches, and one handoff if it occurs.
- End with one review batch and zero automatic doctrine changes.

Success criteria:

- The batch produces fewer, better proposals than ad hoc notebook prose.
- Reviewers can distinguish sourced fact, causal hypothesis, and candidate change quickly.
- No one confuses finished or archived state with accepted work.

Stage 2:

- Add the powerless collector as an append-only helper that drafts entries but cannot publish them without review.

Stage 3:

- Trial adjacent-Lead handoff packets on one class of long-running work where context dilution is already common.

## Open decisions

- Should acceptance remain purely external, or should Paseo later add a first-class acceptance receipt distinct from `archivedAt`?
- What exact cooling window should doctrine candidates require: 3 days, 7 days, or longer?
- Should the ledger live in the product daemon state, the Control Workspace, or as repository-local evidence pointers with a shared index?
- Does the collector run as a product facility, a Supervisor-side tool, or a separate observer surface?
- What minimum corroboration threshold should provider-personality observations require before they influence standing instructions?
- When a successor Lead activates, should the predecessor always remain resumable, or should some handoffs require immediate archive after readback?

## Recommended next experiment

Run Stage 1 only: add no automatic collector and no doctrine mutation. Over 3 to 7 days, capture manual ledger entries for one active Lead/Peer workflow, require explicit separation between fact, hypothesis, and candidate change, and review whether the resulting batch is good enough to justify a powerless collector and a formal adjacent-Lead handoff packet.
