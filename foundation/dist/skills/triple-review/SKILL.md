---
name: triple-review
description: "Run the Lead-owned review topology for one stable material implementation: two sealed heterogeneous semantic lanes plus the private provider-neutral exhaustive-coverage lane. Use only when the current Workspace Protocol requires this review shape or the Human explicitly requests it; do not use for an unstable candidate, an ordinary bounded review, or from Peer/Supervisor authority."
---

# Triple Review

Use Paseo to obtain independent semantic judgment and deterministic review coverage without creating a vote. Lead alone invokes this skill, receives every handback, confronts material contradictions, and issues the technical verdict.

## Preconditions

Before creating a seat:

1. Bind the exact workspace, current Lead lease, applicable `WORKSPACE_PROTOCOL.md`, and candidate contract.
2. Freeze one stable candidate identity that every lane can reproduce, such as an immutable commit or an exact base/head pair. Do not review moving worktree bytes.
3. Write one neutral review brief containing the candidate identity, intended behavior, relevant product constraints, and requested evidence. Do not include suspected defects, another lane's findings, or a preferred conclusion.
4. Confirm the exact provider/model routes. The coverage seat may use any provider route that current SLP supports for a role-bound Peer; do not create a separate review-provider allowlist or silently substitute a caller-pinned route.

If the target is unstable, a required route is unavailable, or Lead cannot state the review boundary, stop with the concrete blocker. Do not degrade to fewer lanes and still call the result triple review.

## Launch three sealed lanes

Create all three as read-only Paseo children of Lead and let them inspect independently:

- Semantic lane A and semantic lane B: two role-bound Peers pinned to strong reasoning routes at high effort, drawn from **different provider families**. Independence comes from separate provider and session lineage, not from a model name. Discover what is currently available, then pin the exact provider, model, and effort in each bounded assignment with reason and expiry.
- Coverage lane: a role-bound Peer using the private provider-neutral `review` execution specialization. Choose from the same provider routes SLP currently supports for ordinary role-bound Peers, then pin the exact provider, model, effort, and mode in the bounded assignment. The specialization adds no provider or model gate of its own.

The two semantic assignments receive only the neutral brief and ordinary Peer constraints. Do not reveal the coverage seat, its implementation mechanism, selected files, or findings to either semantic seat. Create the coverage seat through Lead's private `executionProfile=review` route; do not describe it as a general reviewer or expose its profile in a general Peer catalog. Lead supplies the stable target and coverage contract and does not direct the seat's internal workflow, but may always ask how the reviewable set was selected: a coverage floor Lead cannot reproduce is not evidence.

The coverage assignment must supply the exact candidate, business background, and requested review contract. The private specialization owns its internal deterministic selection and rule-resolution workflow; the assigned review model performs all review reasoning. Its selected reviewable surface is a mandatory coverage floor, not a context ceiling. The exact seat checks its internal dependency after routing and returns a generic coverage-dependency blocker if unavailable; Lead does not install, substitute, or invoke that implementation directly.

Never seed a lane with another lane's findings or conclusions during the sealed pass. Do not ask one seat to supervise, coordinate, or reconfirm another.

## Require accountable handbacks

Each semantic handback must identify the candidate and contract, record checks run, provide evidence-backed findings and uncertainty, and state whether the candidate remained stable.

The coverage handback must additionally account for every selected `(path, status)` entry as reviewed or skipped with a concrete reason; preserve excluded files and reasons, applied rule groups, coverage rate, and findings ordered by severity. Selector output is coverage evidence, never a review conclusion. Keep raw delegate transcripts out of the handback, but name the selector and the exact commands run whenever Lead asks or a coverage claim rests on them: Lead must be able to reproduce how the reviewable set was chosen, and a coverage floor nobody can audit is not evidence.

Reject a handback as stale if its observed candidate differs from the frozen identity. Do not combine evidence across snapshots or infer acceptance from test status, silence, or coverage alone.

## Converge and adjudicate

Lead compares mechanisms and evidence, not reviewer count. There is no majority vote, and the coverage lane is not a third semantic ballot.

When the semantic lanes conflict materially—for example, one requires a synchronous boundary and the other an asynchronous one—Lead writes the contradiction as two falsifiable claims, identifies the governing product or architecture constraint, and returns a neutral contradiction packet to exactly the conflicting lanes after both sealed handbacks exist. Ask each lane:

- what evidence would disprove its own position;
- whether the opposing mechanism can satisfy the same constraint;
- what smallest bounded check resolves the disagreement;
- whether it yields, narrows, or maintains its claim after that check.

Lead may run or route the smallest bounded reproduction needed to resolve the mechanism. Lead then records the accepted claim, rejected claim, decisive evidence, residual uncertainty, and correction route. Repeated findings that share one lifecycle, ownership, state, contract, or foundation mechanism trigger a reopen decision rather than a chain of symptom patches.

Use a council only when this confrontation leaves a consequential decision unresolved or the Human explicitly requests one. The council owns its own mechanics; it is not a routine fourth lane.

## Handoff

Return one compact Lead artifact containing:

- stable candidate identity and reviewed contract;
- exact routes and lane receipts;
- sealed-pass status and any stale or dependency signal;
- semantic findings and the coverage accounting artifact;
- contradiction packets, falsification checks, and lane responses;
- Lead's verdict, correction ownership, residual risk, and any Human decision required.

Only Lead may issue `ACCEPT`, `REVISE`, or reopen the route. Review seats never mutate the candidate, implement fixes, coordinate other seats, or claim room acceptance.
