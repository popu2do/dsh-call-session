# ADR-0037: Host Runtime Compatibility Contract, Non-Strict Service Probing, and the Authoritative Engine Range

- **Status**: Accepted
- **Date**: 2026-10-23
- **Deciders**: Architect, Engineering Team
- **Consulted**: Runtime Ops, Plugin Ecosystem Maintainers
- **Informed**: All Plugin Users, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context

Release 0.1.9 passed every suite it shipped with and was published. On the real host the plugin never activated: the first optional service read in `apply`, a bare `ctx.workspaceRegistry` access inside `resolveWorkspaceRegistry`, threw `cannot get property "workspaceRegistry" without inject` on the Cordis 4 context proxy. Activation aborted, all six tools went unregistered, the telemetry web route and the system prompt section never mounted, and host stderr carried the only signal, one `did not activate` line. The host stayed up while the plugin contributed nothing.

An isolated reproduction matrix settled the blame. The same crash fires on dsh 0.2.0 with Cordis 4.0.4 and on dsh 0.2.1 with Cordis 4.0.5, so the defect is host-generation-agnostic for bare reads and shipped latent in 0.1.9. An A/B on one isolated profile swapping only the plugin artifact showed 0.1.9 reporting `1 entry did not activate` with the telemetry route returning 404, and the probed build returning 401 without a token and 200 with one.

A second bare read survived the first repair pass. `getArchivedSessionIds` read `ctx.archivedSessionIds` and `ctx.archivedSessions` directly; mock suites stayed green and live tool exercise exposed the miss, with `session_query` and `session_call` aborting at call time under the same error class. Every undeclared property read is the same latent crash waiting for a strict host.

A separate latent defect sat in the manifest. The supported dsh range was declared in a nested `dsh.engines.dsh` block that no loader, installer, or market reads, so 0.1.9 shipped with no enforceable runtime requirement anywhere: 0.2.1 and later gate on top-level `engines.dsh` and ignore dsh peers when it is present, while 0.2.0 scans dsh peer ranges, of which the package declares none. The first repair moved the value verbatim to `engines.dsh` as `>=0.1.1-rc.1`, an unbounded range admitting every future host major; the bound `>=0.2.0-rc.2 <0.3.0-0` followed as a correction. Neither placement nor bound is inferable from the code that consumes the field.

### 1.2 Architectural Forces & Constraints

- **Host Strictness Variance**: Cordis 4 context proxies reject undeclared service property reads; mock contexts return undefined for the same reads. The enforcement mechanism is invisible to any suite that does not mount the real proxy.
- **Total, Quiet Failure**: one throw in `apply` removes every capability at once. No per-feature degradation is reachable after activation aborts, and host stderr is the only channel that reports it.
- **Manifest Semantics**: an activation gate reads specific fields. A requirement placed in an unread field is a claim, not a constraint.
- **Verification Realism**: a green suite defines the regression floor only if it can observe the failure class it must catch.

---

## 2. Decision Drivers

- Driver 1: One probing seam as the single source of truth for optional host service access, eliminating the per-module duplication that hid the second bare read.
- Driver 2: Preserve the declared-service contract: `inject` services are host-guaranteed and keep direct access.
- Driver 3: The supported dsh range is declared exactly once, in top-level `engines.dsh`, and bounded to the verified minor line.
- Driver 4: Activation claims require a real-runtime suite; zero registered tools against a real host is the regression signal.

---

## 3. Considered Options

### Option 1: Per-Site Defensive Reads
- **Description**: Wrap each optional read in its own try/catch at the call site.
- **Pros**: Local edit, no new module.
- **Cons**: Scatters the contract across modules and recreates the duplication that let one read survive the first repair.

### Option 2: Declare Every Optional Service in `inject`
- **Description**: Move all optional services into the plugin's `inject` list so the host always provides them.
- **Pros**: Bare reads become legitimate and the seam disappears.
- **Cons**: `inject` is a hard requirement. Demanding services a host may not provide converts graceful degradation into an activation failure on hosts lacking one optional service.

### Option 3 (Chosen): Single Probing Seam with a Bounded, Authoritative Engine Range
- **Description**: Route every optional service lookup through `lib/host-services.mjs`, declare the supported range once in top-level `engines.dsh`, and enforce the contract with a real-Cordis activation suite.
- **Pros**: One seam holds the resolution order and degradation behavior; the host refuses unverified majors up front; the failure class becomes a test failure instead of a production incident.
- **Cons**: One indirection per optional lookup and a manual range review per supported minor.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Single Probing Seam with a Bounded, Authoritative Engine Range.

### 4.1 Core Architectural Invariants
1. **Invariant 1 (Non-Strict Probes)**: Optional host services are read only through `readProperty` and `readHostService`. A probe returns a value or undefined and degrades instead of throwing.
2. **Invariant 2 (Declared-Service Directness)**: Services in the plugin's `inject` list (`agents`, `tools`, `systemPrompt`) keep bare access; the seam exists for undeclared services only. Provided services (`callTelemetry`, `boardStore`) are written under the same guarded discipline.
3. **Invariant 3 (Authoritative Engine Range)**: The supported dsh range is declared exactly once, as top-level `engines.dsh`, bounded to the verified minor line. Nested or duplicate declarations are forbidden.
4. **Invariant 4 (Real-Runtime Verification)**: Activation behavior is proven by mounting the plugin in a real Cordis app. Mock-context suites verify logic, not activation.

### 4.2 System Architecture & Topology
```
[apply]
  |- declared inject services --> bare access, host-guaranteed
  |- optional service lookup --> readHostService(ctx, name)
  |      1. root ctx.get(name, false)
  |      2. local ctx.get(name, false)
  |      3. guarded property read, root then local
  |      `- miss --> undefined --> per-feature degradation
  `- provided services --> guarded ctx write

[package.json engines.dsh] --> 0.2.1+ activation gate: enforce, refuse outside range
                         `--> 0.2.0 peer scan: no dsh peers declared, accept
```

### 4.3 Interface & Protocol Contracts
```
readProperty(target, key) -> value | undefined
readHostService(ctx, name) -> service | undefined
"engines": { "node": ">=20.0.0", "dsh": ">=0.2.0-rc.2 <0.3.0-0" }
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- Activation survives host strictness variance across Cordis generations.
- Service absence degrades per feature instead of removing every tool at once.
- An unverified host major is refused up front instead of failing at runtime.
- The bare-read crash class is a test failure, with the real-runtime suite reporting zero registered tools against the 0.1.9 artifact.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Probe indirection**: one function call per optional lookup.
  - *Mitigation*: one seam, six import sites, no per-module copies.
- **Range maintenance**: each supported minor needs a host verification pass before the bound moves.
  - *Mitigation*: `tests/plugin-manifest.test.mjs` asserts the exact range and boundary versions, and the README compatibility rows move in the same commit.

### 5.3 Neutral & Operational Shifts
- Compatibility wording in README and CHANGELOG travels with the range value as one unit.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Unit / Contract Tests**: `tests/host-services.test.mjs` drives strict-proxy and throwing-proxy contexts and asserts probe survival and degradation. `tests/plugin-manifest.test.mjs` asserts the exact `engines.dsh` value and semver boundaries, accepting `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.2` and rejecting `0.1.5-rc.2`, `0.3.0-rc.1`, `0.3.0`.
- **Integration / Smoke Tests**: `tests/cordis-activation.test.mjs` mounts the plugin in a real Cordis app and asserts six registered tools, visible provided services, and degradation on a missing optional service; it reports zero registered tools against 0.1.9. Live verification on a dsh 0.2.1 profile registered six tools and completed a `session_call` round trip.
- **Fault Injection / Boundary Tests**: the throwing-proxy context simulates the Cordis trap on every property read; the isolated-host A/B reproduced the did-not-activate and 404 signals against 0.1.9 and their absence against the probed build.

### 6.2 Code Review & Maintenance Checklist
- [ ] Every new context-proxy read is either declared in `inject` or routed through the probe seam.
- [ ] The engine range moves only after a verified host release, in the same commit as the README compatibility rows.
- [ ] Any `apply`-path change re-runs the real-Cordis activation suite.

---

## 7. Status History & Related Artifacts

- **2026-10-23**: Accepted.
- **Related ADRs**:
  - Extends: ADR-0006, widening graceful degradation from transport payload fields to host service access.
  - Related to: ADR-0033, ADR-0036.
- **Implementation Artifacts**:
  - Primary source: `lib/host-services.mjs`, `lib/session-directory.mjs`, `package.json`
  - Test suites: `tests/host-services.test.mjs`, `tests/cordis-activation.test.mjs`, `tests/plugin-manifest.test.mjs`
