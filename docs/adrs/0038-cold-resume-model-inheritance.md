<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0038: Cold Resume Model Inheritance and Prompt Assembly Survivability

- **Status**: Accepted
- **Date**: 2026-10-29
- **Deciders**: Architect, Engineering Team
- **Consulted**: Runtime Ops, Multi-Agent Orchestrators
- **Informed**: All DSH Developers
- **Related**: ADR-0015, ADR-0021, ADR-0025, ADR-0036

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context

`session_call` accepts targets that are not loaded in the current host process. The session directory cold-resumes such targets with the host resume API. Before this decision the call passed no agent options, so the restored agent was assembled with empty options and `agent.options.provider` / `agent.options.model` stayed undefined.

The default deployment persona prefix requires the model name. Prompt assembly reads `context.agent?.options.model` and throws when the value is missing:

```
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")
```

The dispatched turn failed before any model request, and the broken agent remained resident in memory, causing every subsequent message to that session to fail identically until the host restarted. This failure mode was first captured under ADR-0036. The host's own resume path avoids this failure because it always supplies options.

### 1.2 Architectural Forces & Constraints

- **Host contract alignment**: The host session controller resumes with options, and the host agent loop builds the agent from those options. Recovery without options is structurally incompatible with prompt variables registered from agent options.
- **Model domain ownership**: Model resolution lives in the host gateway per ADR-0015 and ADR-0021. The session directory must not reimplement it.
- **Dependency direction**: The host gateway already imports service resolvers from the session directory, so the directory cannot import model resolution back without a circular dependency. The resolver enters via dependency injection from the dispatch entry point, keeping the directory model-agnostic.
- **Failure isolation**: Option resolution is a best-effort enrichment. Failing to resolve a model must not disable session recovery altogether.

---

## 2. Decision Drivers

- Driver 1: Cold resume must reproduce the host resume contract closely enough that prompt assembly cannot fail on a missing model.
- Driver 2: One model resolution authority shared by peer creation and cold resume.
- Driver 3: No caller option leakage into a foreign session.
- Driver 4: Recovery is attempted even when enrichment fails.

---

## 3. Considered Options

### Option 1: Keep the optionless resume
- **Pros**: Minimal diff.
- **Cons**: Leaves the prompt assembly failure intact; cold targets become unusable until host restart.

### Option 2: Pass full resolved model options
- **Pros**: Mirrors peer creation literally.
- **Cons**: Carries caller working directory, preset, and temperature. Resuming a foreign session with caller options silently changes target identity.

### Option 3 (Chosen): Pass a narrowed model triple resolved by the gateway
- **Pros**: Satisfies the host contract, reuses the single model authority, keeps caller leftovers out.
- **Cons**: Second narrowing point next to model resolution, mitigated by co-locating it as an exported helper.

### Option 4: Also pass setup from the target preset
- **Pros**: Matches host resume path further.
- **Cons**: Reusing preset setup resolution would mount caller presets onto foreign sessions. Out of scope for this decision.

---

## 4. Decision Outcome

**Chosen Option**: Option 3. Cold resume carries the effective model triple, and preset setup stays unpassed.

### 4.1 Core Architectural Principles & Invariants

1. **Invariant 1 — Model inheritance on recovery**: Cold resume supplies agent options with caller effective provider, model, and reasoning effort, falling back to host defaults, exactly as peer creation does.
2. **Invariant 2 — Narrow projection**: Only those three keys cross into resume agent options. Any other caller option is dropped.
3. **Invariant 3 — Single authority, injected**: The projection is exported from the host gateway and injected into target resolution by the dispatch caller. The session directory never re-derives a model and never imports the gateway.
4. **Invariant 4 — Usability gate**: The helper returns undefined unless model resolved, and the caller attaches agent options only for a defined result. Persona assembly reads model name, so provider or effort alone cannot make a resumed agent usable.
5. **Invariant 5 — Degradation, not cancellation**: A resolution failure is logged at debug level and the resume proceeds without agent options; an omitted resolver skips enrichment silently.

### 4.2 System Architecture & Topology

```
session_call (lib/session-call.mjs)
  └─ SessionDirectory.resolveTarget(target, { callerAgent, resolveResumeAgentOptions })
       └─ options.resolveResumeAgentOptions()          // injected, no circular import
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
  resolveResumeAgentOptions,   // () => model triple | undefined
})

agents.resume({
  resumeSessionId,          // canonical session-<uuid>
  agentOptions,             // provider/model/reasoningEffort only when model resolved
})
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)

- Cold targets survive prompt assembly and become usable immediately after recovery.
- One model resolution authority; peer creation and cold resume cannot drift.
- Caller workspace and preset never leak into a resumed session.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)

- **Tradeoff 1**: A resumed session mounts no preset and receives no controller selection alignment.
  - *Mitigation*: Documented as residual risk for a separate preset persistence decision.
- **Tradeoff 2**: A resolver that is not injected degrades silently to an optionless resume.
  - *Mitigation*: The single production call site always injects, pinned by dedicated tests.

### 5.3 Neutral & Operational Shifts

- Cold resume behaves like peer creation on the model axis, failing and logging through the same authority.
- Operators gain a debug line naming the target when model resolution throws.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite

- **Unit and Contract Tests**: Tests in `tests/session-directory.test.mjs` and `tests/dsh-host-gateway.test.mjs` assert caller inheritance, host default fallback, three-key projection dropping caller leftovers, and recovery execution when resolution throws.
- **Regression**: Existing cold-resume canonical ID tests.
- **Contract checks**: `npm run verify` and `npm run typecheck`.

### 6.2 Code Review & Maintenance Checklist

- [x] Any new resume path passes agent options resolved by the gateway.
- [x] No caller option beyond the model triple reaches agent options.
- [x] Recovery remains attempted when enrichment throws.

---

## 7. Status History & Related Artifacts

- **2026-10-29**: Proposed and accepted with the fix for issue #10.
- **Resolves**: Root-cause failure in cold resume prompt assembly identified in ADR-0036.
- **Related ADRs**:
  - Related to: [ADR-0015](./0015-peer-session-model-and-preset-inheritance.md)
  - Related to: [ADR-0021](./0021-concurrent-running-quota-and-model-inheritance-alignment.md)
  - Related to: [ADR-0025](./0025-peer-session-creation-gateway-safeguard-and-bootstrap-decoupling.md)
  - Related to: [ADR-0036](./0036-target-acceptance-causal-verification-and-structured-error-contract.md)
- **Implementation Artifacts**:
  - Primary source: `lib/session-directory.mjs`, `lib/dsh-host-gateway.mjs`
  - Test suites: `tests/session-directory.test.mjs`, `tests/dsh-host-gateway.test.mjs`
