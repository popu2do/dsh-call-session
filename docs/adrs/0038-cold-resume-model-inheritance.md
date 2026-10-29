# ADR-0038: Cold Resume Model Inheritance and Prompt Assembly Survivability

- **Status**: Accepted
- **Date**: 2026-10-29
- **Deciders**: Architect, Engineering Team
- **Consulted**: Runtime Ops, Multi-Agent Orchestrators
- **Informed**: All DSH Developers
- **Related**: ADR-0015, ADR-0021, ADR-0025

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context

`session_call` accepts targets that are not loaded in the current host process. `SessionDirectory.resolveTarget()` cold-resumes such targets with `agents.resume({ resumeSessionId })`. Before this decision the call passed no `agentOptions`, so the restored agent was assembled with empty options and `agent.options.provider` / `agent.options.model` stayed `undefined`.

The default web deployment persona prefix is the template `You are a coding agent powered by the {{model}} model.`. Prompt assembly reads `context.agent?.options.model` and throws when the value is missing:

```
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")
```

The dispatched turn failed before any model request, and the broken agent remained resident, so every later message to that session failed identically until the host restarted. The host's own resume path never exhibits this failure because it always supplies options.

### 1.2 Architectural Forces & Constraints

- **Host contract alignment**: `@deepseek-ai/dsh-api-session-controller` resumes with `{ resumeSessionId, agentOptions, setup }`, and `@deepseek-ai/dsh-agent-loop` builds the agent from `options.agentOptions ?? {}`. Recovery without options is therefore structurally incompatible with prompt variables registered from `context.agent.options`.
- **Model domain ownership**: model resolution lives in `lib/dsh-host-gateway.mjs` (ADR-0015, ADR-0021). `lib/session-directory.mjs` must not reimplement it.
- **Dependency direction**: `lib/dsh-host-gateway.mjs` already imports `resolveAgentsService` from `lib/session-directory.mjs`, so `lib/session-directory.mjs` cannot import model resolution back without a cycle. The resolver enters through `resolveTarget({ resolveResumeAgentOptions })` from `lib/session-call.mjs`, the only production call site, which keeps the directory module model-agnostic.
- **Failure isolation**: option resolution is a best-effort enrichment. Failing to resolve a model must not disable session recovery altogether.

---

## 2. Decision Drivers

- Driver 1: Cold resume must reproduce the host's own resume contract closely enough that prompt assembly cannot fail on a missing model.
- Driver 2: One model resolution authority shared by `session_create` and cold resume.
- Driver 3: No caller option leakage into a foreign session.
- Driver 4: Recovery is attempted even when enrichment fails.

---

## 3. Considered Options

### Option 1: Keep the optionless resume
- **Pros**: Smallest diff.
- **Cons**: Leaves the reported failure intact; every cold target becomes unusable until host restart.

### Option 2: Pass the full `resolveEffectiveModel` result
- **Pros**: Mirrors `session_create` literally.
- **Cons**: That result also carries caller leftovers (`cwd`, `preset`, `temperature`). Resuming a foreign session with the caller's working directory or preset silently changes the target session's identity.

### Option 3 (Chosen): Pass a narrowed model triple resolved by the gateway
- **Pros**: Satisfies the host contract, reuses the single model authority, keeps caller leftovers out.
- **Cons**: A second narrowing point next to `resolveEffectiveModel`, mitigated by keeping it in the same module as one exported helper.

### Option 4: Also pass `setup` from the target's own preset
- **Pros**: Matches the host resume path one step further.
- **Cons**: The target's preset is reachable through the target `agentPreset` projection, which the host resolves for observation, but `resolvePresetSetup` derives presets from the caller chain; reusing it would mount the caller's preset onto the target session. Out of scope for this decision: a resumed session keeps no preset, recorded as Tradeoff 1.

---

## 4. Decision Outcome

**Chosen Option**: Option 3. Cold resume carries the effective model, and `setup` stays unpassed.

### 4.1 Core Architectural Principles & Invariants

1. **Invariant 1 — Model inheritance on recovery**: cold resume supplies `agentOptions` with the caller's effective `provider`, `model`, and `reasoningEffort`, falling back to the host default selection, exactly as peer creation does.
2. **Invariant 2 — Narrow projection**: only those three keys cross into `resumeOptions.agentOptions`. Any other caller option is dropped.
3. **Invariant 3 — Single authority, injected**: the projection is exported from `lib/dsh-host-gateway.mjs` as `resolveResumeAgentOptions` and injected into `resolveTarget` by `lib/session-call.mjs`. `lib/session-directory.mjs` never re-derives a model and never imports the gateway.
4. **Invariant 4 — Usability gate**: the helper returns `undefined` unless `model` resolved, and the caller attaches `agentOptions` only for a defined result. Persona assembly reads `agent.options.model`, so a provider or a reasoning effort alone cannot make a resumed agent usable. The same helper `pickModelSelection` backs the `session_create` model selection sync, so both paths project the same three keys.
5. **Invariant 5 — Degradation, not cancellation**: a resolution failure is logged at debug level and the resume proceeds without `agentOptions`; a resolver that was never injected skips enrichment silently. Recovery that yields no callable agent reports `[InvalidParameter]` for a target shorter than the prefix minimum and `[TargetNotFound]` otherwise, unchanged from before this decision.

### 4.2 System Architecture & Topology

```
session_call (lib/session-call.mjs)
  └─ SessionDirectory.resolveTarget(target, { callerAgent, resolveResumeAgentOptions })
       └─ options.resolveResumeAgentOptions()          // injected, no import back
            └─ resolveResumeAgentOptions({ ctx, callerAgent })   // lib/dsh-host-gateway.mjs
                 └─ pickModelSelection(resolveEffectiveModel(...))
                      └─ agents.resume({ resumeSessionId, agentOptions? })
```

### 4.3 Interface & Protocol Contracts

```js
resolveResumeAgentOptions({ ctx, callerAgent }) -> { provider?, model?, reasoningEffort? } | undefined

resolveTarget(rawTarget, {
  callerSessionId,
  callerAgent,
  exec,
  resolveResumeAgentOptions?,   // () => model triple | undefined
})

agents.resume({
  resumeSessionId,          // canonical session-<uuid>
  agentOptions?,            // provider/model/reasoningEffort only when model resolved
})
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)

- Cold targets survive prompt assembly and become usable immediately after recovery.
- One model resolution authority; `session_create` and cold resume cannot drift.
- Caller workspace and preset never leak into a resumed session.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)

- **Tradeoff 1**: A resumed session still mounts no preset and gets no `sessionController` selection alignment (`selectForNextRequest`).
  - *Mitigation*: documented here and on the pull request as residual risk; each is a separate decision.
- **Tradeoff 2**: A resolver that is not injected degrades silently to an optionless resume, which reproduces the original assembly failure on a host that also lacks `agentDefaultModel`.
  - *Mitigation*: the single production call site always injects, a dedicated test pins that behaviour, and the host default selection normally covers the gap.

### 5.3 Neutral & Operational Shifts

- Cold resume now behaves like peer creation on the model axis, so both paths fail the same way and log through the same authority.
- Operators gain one log signal: a debug line naming the target when model resolution throws.
- A host-side default reselection after cold resume remains possible because `selectForNextRequest` is not applied; the resumed agent keeps the provider/model it was given until then.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite

- **Unit / Contract Tests** (`tests/session-directory.test.mjs`): caller inheritance; host default fallback; three-key projection dropping caller leftovers; resume still issued when resolution throws, with exactly one debug line naming the target and nothing at warn or error; no `agentOptions` when the resolver is absent or the model is incomplete.
- **Unit / Contract Tests** (`tests/dsh-host-gateway.test.mjs`): the exported helper drops caller leftovers, falls back to the host default selection, returns `undefined` for provider-only, effort-only and empty input.
- **Regression**: existing cold-resume canonical id test in the same suite.
- **Integration / Smoke**: none automated; the worktree has no `dsh-api-session-controller` / `dsh-agent-loop` dependency, so the host resume contract is exercised only through the mock context.
- **Live Verification (manual, required before merge)**: register the local checkout in `cordis.patch.yml`, restart `dsh web`, call `session_call` against a target absent from host memory, and confirm `agent.options.provider` / `agent.options.model` match the caller, the persona `{{model}}` assembly no longer throws, the target is not left in the error state, and the session accepts a second message before any restart.
- **Contract checks**: `npm run verify`, `npm run typecheck`.

### 6.2 Code Review & Maintenance Checklist

- [ ] Any new resume path passes `agentOptions` resolved by the gateway.
- [ ] No caller option beyond the model triple reaches `agentOptions`.
- [ ] Recovery remains attempted when enrichment throws.

---

## 7. Status History & Related Artifacts

- **2026-10-29**: Proposed and accepted with the fix for issue #10.
- **Related ADRs**:
  - Related to: ADR-0015, ADR-0021, ADR-0025
- **Implementation Artifacts**:
  - Primary source: `lib/session-directory.mjs`, `lib/dsh-host-gateway.mjs`
  - Test suites: `tests/session-directory.test.mjs`, `tests/dsh-host-gateway.test.mjs`
