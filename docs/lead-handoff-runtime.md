# Lead handoff runtime

Durability and concurrency mechanics behind `prepare_lead_handoff` / `transition_lead_handoff`.
The agent-facing workflow and its gates live in `skills/paseo-handoff/SKILL.md`; this doc owns the
daemon-side design so the skill does not restate it. Implementation:
`packages/server/src/server/agent/lead-handoffs.ts`.

## Receipts before mutations

`successor_authorized` and `successor_acknowledged` are durable receipts, not lifecycle mutations.
Only the final `predecessor_released` mutates runtime state: it requires an idle predecessor, closes
its provider runtime while retaining the durable agent record, then transfers
`currentWriteOwnerAgentId` to the successor. Runtime-closure failure aborts the transition without
changing the Owner.

## Final-release concurrency

Final release revalidates both agent identities under stable-ordered locks, so two concurrent
transitions cannot deadlock or interleave their identity checks. It joins an in-flight runtime close
instead of starting a second one, remembers a close failure until daemon restart (a retried release
must not pretend the earlier failure did not happen), and bounds the close wait so a stuck provider
cannot hold the successor lock indefinitely. The close-wait timeout must abort any continuation
before that continuation can start a later runtime close.

## Durability and restart reconciliation

Audit-timeline reads use durable state only — they must never resume a released provider runtime to
answer a read. Timeline batches record a durable pending intent before row commits, so a restart can
reconcile partially written batches. Final release reconciles that pending intent and fails closed
if durability remains unresolved.

## Process-loss semantics

A pre-manifest failure is a current-daemon release blocker and a graceful-shutdown blocker. Repair
drains are serialized per agent, and every known repair is attempted before reporting aggregate
shutdown failure. The daemon does not claim recovery from hard process loss inside the exact
unqualified interval — that window is reported, not papered over.

## Identity rules

A released predecessor identity is never reactivated as a later successor; continuity after release
means creating a fresh role-bound Lead identity. Prompt dispatch and unarchive-and-prompt for a
released predecessor stay blocked. Final release does not detach, archive, or change role binding.
