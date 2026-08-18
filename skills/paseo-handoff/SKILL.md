---
name: paseo-handoff
description: Hand off a bounded task or transfer Lead continuity with complete context and explicit authority receipts. Use when the user says "handoff", "hand off", "hand this to", wants to pass work to another agent, or asks to replace an active Lead without losing decisions and evidence.
user-invocable: true
---

# Handoff Skill

Transfer the current task — context, decisions, failed attempts, constraints — to a fresh agent. The receiving agent starts with **zero context**, so the handoff prompt must be a self-contained briefing.

**User's arguments:** $ARGUMENTS

## Prerequisites

Read the **paseo** skill. Call `list_profiles` before choosing the receiving agent. Do not create it until you have read the configured profiles and their `notes`.

## Parsing arguments

1. **Agent profile** — explicit profile name first; otherwise choose the profile whose `notes` best match the work. Materialize it into `create_agent` as described by the **paseo** skill. If no profile fits, use Paseo's provider discovery fallback.
2. **Isolation** — "in a worktree" / "worktree" → create a workspace with `isolation: "worktree"`, using a short branch name derived from the task.
3. **Task description** — anything else the user said.

First classify the request:

- **Ordinary task transfer** — create a receiving agent with a self-contained briefing; no authority transfer.
- **Adjacent-Lead continuity handoff** — use the gated packet workflow below. Do not represent ordinary
  subagent creation or detach as Lead promotion.

## The handoff prompt

The receiving agent has zero context. Include:

```
## Task
[Imperative description.]

## Context
[Why this task exists, required context.]

## Relevant files
- `path/to/file.ts` — [what it is and why it matters]

## Current state
[What's done, what works, what doesn't.]

## What was tried
- [Approach] — [why it failed or was abandoned]

## Decisions
- [Decision — rationale]

## Acceptance criteria
- [ ] [Criterion]

## Constraints
- [Must-not / must-preserve]
```

**Preserve task semantics.** Investigate-only → "DO NOT edit files." Fix → "implement the fix." Refactor → "refactor, not rewrite." Carry the user's exact intent.

## Launch

### Ordinary task transfer

Prepare the handoff in a dedicated workspace:

1. Select the current workspace or call `create_workspace` with the requested isolation.
2. Call `create_agent` with a `[Handoff] <task>` title, the briefing as initial prompt, and the selected `workspaceId` when explicit placement is needed.
3. Return the agent and workspace to the user, explaining that it remains in your subagent track until they detach it manually.

Do not encode independence as a create mode and do not invoke CLI or wire-level detach operations. Detach is a user gesture in the subagents track.

Leave `notifyOnFinish` omitted unless the user explicitly wants no callback.

Don't wait by default — the user decides whether to follow along or move on. Tell them the agent ID and how to follow along (the paseo skill explains).

### Adjacent-Lead continuity handoff

Require an exact Human handoff/replacement mandate and a role-bound predecessor Lead. Then:

1. Bring the predecessor to a bounded stop point. Freeze new writes; do not stop it mid-scope merely
   because a recommendation exists.
2. Call prepare_lead_handoff from the predecessor Lead. Include objective, scope, current state,
   current write Owner, decisions, failed approaches, successful patterns, concrete evidence index,
   active risks/blockers, exact resume point, and stop condition. The packet may omit a successor until
   Human chooses one.
3. Only after packet_ready, let Human select or create a role-bound successor Lead in the same
   workspace. A newly created successor initially verifies the packet and remains non-mutating.
4. From a Human-facing session, call transition_lead_handoff with
   transition=successor_authorized and the exact successorAgentId.
5. Give the frozen packet to that successor. It independently verifies current bytes and either calls
   transition_lead_handoff with successor_acknowledged, or rejects the packet with discrepancies.
6. Only after successor ACK may Human record predecessor_released.

Human authorization and release have no elapsed-time cooling delay. The packet, successor ACK, and safe
idle boundary are the gates. Automated coordination signals remain advisory: do not turn one signal into
replacement or authority transfer, and require repeated or independently corroborated evidence before
proposing an authority-changing correction.

The first transitions are durable receipts, not lifecycle mutations. Final `predecessor_released`
requires an idle predecessor, closes its runtime while retaining its durable record, then transfers
`currentWriteOwnerAgentId` to the successor. Runtime-closure failure aborts the transition without
changing the Owner. Later prompt dispatch or unarchive-and-prompt for the predecessor is blocked, and
final release does not detach, archive, or change role binding. Never reactivate a released
predecessor identity as a later successor; create a fresh role-bound Lead identity instead. The
daemon-side locking, durability, and process-loss mechanics are documented in
`docs/lead-handoff-runtime.md` — the skill relies on those guarantees but does not restate them.
If the first-class handoff tools are unavailable, stop with a manual frozen packet and report
the mechanism as unsupported; do not fake transition receipts with chat prose.
