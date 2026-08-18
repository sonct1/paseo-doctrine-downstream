# Council model routing

Read `~/.paseo/orchestration-preferences.json` once per Council and use its `council` entries. Do not
list providers/models unless a configured route is missing, rejected, or explicitly overridden by the
Human.

| Seat method | Preferred key | Compatibility fallback |
|---|---|---|
| Solution Architect | `council.architect` | `council.reasoning` |
| Reviewer | `council.reviewer` | `council.challengerReasoning`, then `council.reasoning` |
| High-risk Architect | `council.highRiskArchitect` | `council.highRiskReasoning`, then Architect route |
| Evidence Verifier | `council.verifier` | none |
| Deep semantic Verifier | `council.deepVerifier` | Architect route |
| Draft-verdict Reviewer | `council.auditor` | Reviewer route |
| High-risk draft Reviewer | `council.deepAuditor` | `council.deepVerifier`, then Reviewer route |

The legacy keys (`council.reasoning`, `council.challengerReasoning`, `council.highRiskReasoning`) are
compatibility fallbacks only; the other fallbacks in the column are canonical routes reused as
defaults. Remove the legacy keys when the daemon requires a preferences schema version that ships the
canonical keys; do not add new routes under legacy names.

Each entry may contain `provider`, `mode`, and `thinking`. Map these to
`create_agent.provider`, `settings.modeId`, and `settings.thinkingOptionId`. Omit absent settings.

Execution profile and provider route are independent:

```text
Peer + solution-architect + bounded assignment + qualified provider/model
Peer + reviewer            + bounded assignment + qualified provider/model
```

Do not create Claude-, Codex-, Cursor-, Zetscan-, or Antigravity-specific copies of either profile.
Any provider may carry a Council seat only when the current daemon qualifies its Peer durable-role
channel and mandatory Beads transport. Antigravity remains Peer-only; if its bridge cannot carry the
tracker checkpoint, it is unavailable for that Council rather than silently downgraded.

For the default pair, prefer different qualified provider/model families when configured. Sealed
prompts remove cross-contamination between seats, but two seats from one model family still share
training priors: their agreement is correlated, so it is weak evidence, while cross-family agreement
is strong evidence and cross-family disagreement is exactly the signal the Council exists to surface.
Family diversity reduces shared blind spots but creates no authority and is not a vote. Never use a
weak provider only to manufacture diversity. The Human controls the current Lead route; Council does
not inspect or replace it.

In high-risk mode, only the drafting seats upgrade: `highRiskArchitect` replaces the Architect route,
and `deepAuditor` replaces the draft-verdict Reviewer route. The plain Reviewer and Verifier seats
keep their configured cross-family routes — upgrading every seat to the same strongest model would
collapse the family split that makes their agreement meaningful. Note the fallback chain does not
preserve that split by itself: an unconfigured `deepVerifier` inherits the Architect route, which in
high-risk mode resolves to the same model as the drafting seat. Configure `deepVerifier` (and
`deepAuditor`) cross-family explicitly when high-risk work matters.

Core law: cheap workers buy coverage; strong seats buy deliberation; the Lead adjudicates. Worker
count never converts into decision weight.
