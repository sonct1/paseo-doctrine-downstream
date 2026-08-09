# Council model routing

Read `~/.paseo/orchestration-preferences.json` once per invocation and use its `council` entries
directly. Do not list providers or models preemptively; discover them only when a configured value
is missing, rejected by `create_agent`, or explicitly overridden by the user.

| Function | Preference key | Fallback | Policy |
|---|---|---|---|
| Independent | `council.reasoning` | none | Default strong reasoning seat |
| Premise Challenger | `council.challengerReasoning` | `council.reasoning` | Prefer a different model family than the Independent |
| High-risk reasoning | `council.highRiskReasoning` | `council.reasoning` | Strongest configured seat |
| Specialist | `council.specialist` | `council.reasoning` | Only when domain semantics matter |
| Evidence / counterexample worker | `council.verifier` | none | Cheap bounded coverage |
| Deep semantic verifier | `council.deepVerifier` | `council.reasoning` | Source meaning requires judgment |
| Draft-verdict auditor | `council.auditor` | `council.verifier` | Bounded output audit |
| Deep/high-risk auditor | `council.deepAuditor` | `council.deepVerifier`, then `council.reasoning` | Semantic verdict audit |

Each entry may contain `provider`, `mode`, and `thinking`. Map them to `create_agent.provider`,
`settings.modeId`, and `settings.thinkingOptionId`. Omit missing settings.

Sealed prompts remove contamination between seats but not correlation: two seats sampled from
the same model family share training priors and blind spots, so their agreement is weak
evidence. Configuring `council.challengerReasoning` on a different strong model family than
`council.reasoning` is the cheapest way to make `debate` meaningfully stronger than `lens`. Do
not route the Challenger to a cheap coverage model just to differ in family. In the `high-risk`
tier only the Independent switches to `council.highRiskReasoning`; the Challenger stays on
`council.challengerReasoning` at high-or-stronger thinking so the cross-family split survives.

The human controls the current Lead model and reasoning effort. Council routing neither checks nor
changes it and never spawns a replacement Lead.

Topology is not model routing. Always create Council seats as parent-owned first-class Paseo agents
in the Lead's existing Paseo workspace. Paseo parentage preserves lifecycle notification routing;
it does not use provider-native or Codex-native subagent tools.

Core law:

```text
Cheap workers increase coverage.
Strong seats perform deliberation.
The current Lead owns adjudication.
```

Never convert worker count into decision weight. Never route a cheap worker to the binding verdict.
