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

For the default pair, prefer different qualified provider/model families when configured. This
reduces shared blind spots but creates no authority and is not a vote. Never use a weak provider only
to manufacture diversity. The Human controls the current Lead route; Council does not inspect or
replace it.
