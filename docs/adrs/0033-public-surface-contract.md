# ADR-0033: Public Surface Contract and Ecosystem Presence Registry

- **Status**: Accepted
- **Date**: 2026-10-16
- **Deciders**: Architect, Documentation Team, Core Contributors
- **Consulted**: Maintainers, QA Reviewers, Plugin Community
- **Informed**: All Plugin Users, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
A developer meets this plugin through one catalog line, not a search result. That line, and the first screen behind it, describe mechanism: in-process cross-session communication, peer session creation, shared blackboard. They never state what the reader gets, and they never show the artifact this ecosystem circulates, a topology view that can be screenshotted and passed around.

The consequence is measurable: the package is installed more often than the direct cross-session peers listed beside it in the same catalog category, while stars, forks, watchers and external issues sit at or near zero. Nothing currently protects the public surface. Positioning copy, the repository description and topics, the demonstration asset and the catalog entry are hand-edited in four places, drift apart between releases, and can silently leak environment-specific detail into a published artifact. Improvements decay because no test notices.

### 1.2 Architectural Forces & Constraints
- **Single authorship**: positioning copy, discovery keywords, first-screen anchors and asset budgets must be authored in exactly one machine-readable place, so a release updates catalog copy, repository metadata and the first screen together.
- **Determinism & Cost**: verification must be network-free and platform-independent so it runs in the same suite on every commit, with no timing dependence and no external service in the critical path.
- **One Rule Source**: credential detection must reuse the existing scanner rather than reimplement its patterns, keeping exactly one definition of a credential shape.
- **Disclosure Risk**: published artifacts must not carry home directory paths, private host names, credentials or personal account identifiers.
- **Documentation Restraint**: existing zero-emoji, four-character Chinese subheading, bilingual parity, no-superlative and native-delegation-first invariants constrain every copy change.
- **First-Screen Weight**: the demonstration asset is downloaded before anything is read, so its byte ceiling is a product constraint rather than a preference.

---

## 2. Decision Drivers

- Driver 1: One authored source for the public surface, so catalog copy, metadata and the first screen cannot disagree.
- Driver 2: Build-enforced drift detection, so a regression is caught by the pipeline rather than by a reader.
- Driver 3: Mechanical sanitization, so disclosure review is a gate instead of an intention.
- Driver 4: Reproducible registration, so the next maintainer re-runs a documented submission instead of rediscovering it.
- Driver 5: Preserve the restrained documentation decision while allowing the canvas demonstration to lead the first screen.

---

## 3. Considered Options

### Option 1: Prose-Only Governance
- **Description**: Keep positioning copy and registration state in README prose and maintainer memory, and rely on review.
- **Pros**: No new artifact and no test maintenance.
- **Cons**: The drift that motivated this decision is exactly what review failed to catch; nothing fails when the catalog line, the repository description and the first screen disagree.

### Option 2: Test-Hardcoded Expectations
- **Description**: Write the positioning claim, keyword list and asset ceilings directly into the integrity test.
- **Pros**: Enforcement without a manifest file.
- **Cons**: Values become test constants, so editing copy means editing a test; there is no authored source and no place to record catalog registration state.

### Option 3 (Chosen): Versioned Manifest with an Integrity Gate and a Registration Registry
- **Description**: `presence.json` holds positioning copy for both languages, the discovery keyword set, the package description, first-screen anchor requirements, per-asset byte floors and ceilings, and the per-catalog registration records. One static test module validates the manifest, the artifacts derived from it, the asset budgets and two sanitization halves. `docs/agents/ecosystem-presence.md` records each catalog and its submission state.
- **Pros**: Authored once; drift, budget violation and disclosure become build failures; registration is reproducible.
- **Cons**: One more tracked artifact and one more test module; a copy edit now requires a manifest edit and a green suite.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Versioned Manifest with an Integrity Gate and a Registration Registry.

### 4.1 Core Architectural Principles & Invariants
1. **Manifest Single Source Invariant**: `presence.json` is the only authored place for the English and Chinese positioning copy, the discovery keyword set, the package description, first-screen anchors and asset budgets. Catalog copy, repository metadata and the first screen are derived values.
2. **Integrity Gate Invariant**: one static test module in the existing suite fails the build when a tracked public artifact drifts from the manifest, when an asset violates its byte budget or format signature, or when a tracked file exposes environment-specific information. No production module changes and no runtime seam are introduced.
3. **Two-Halves Sanitization Invariant**: credential detection is delegated to the existing scanner invoked in whole-repository mode as a subprocess and must exit clean, so credential rules keep one source; the gate additionally enforces the disclosure rules the scanner does not cover, namely absolute home directory paths, Windows user-directory paths, private host names and personal account identifiers in registration records.
4. **Asset Budget Invariant**: every declared asset declares a format and a byte floor and ceiling. The gate asserts existence, format signature and byte range, so first-screen weight cannot grow silently.
5. **Registry Operational Invariant**: `docs/agents/ecosystem-presence.md` records, per catalog, the identifier exactly as it appears in the manifest, the submission mechanism and requirement, the verbatim submitted copy, the submission reference, the status, the verification date and the refresh procedure. The manifest's catalog records are asserted structurally by the gate; the registry document and the external submissions are reviewed by hand before publication.
6. **Documentation Discipline Invariant**: the ADR-0009 invariants remain in force: zero emoji, Chinese subheadings of at most four characters, strict bilingual structural parity, plain technical language, and the standing recommendation to prefer native single-task delegation before cross-session coordination.
7. **No Engagement Mechanics Invariant**: paid placement, star solicitation, coordinated voting and multi-account engagement are out of scope. This contract governs discoverability and comprehension only.

### 4.2 System Architecture & Topology
```
presence.json  (single authored source: copy, keywords, first-screen anchors, asset budgets, catalog records)
      |
      | read by
      v
tests/public-surface-integrity.test.mjs
      |
      +-- asserts --> README.md / README_ZH.md   first-screen anchor placement, zero emoji,
      |                                           four-character Chinese subheadings, level-2 parity
      +-- asserts --> package.json               description and keywords agree with the manifest
      +-- asserts --> assets/*                   existence, format signature, byte floor and ceiling
      +-- asserts --> presence.json              manifest completeness, catalog record structure, dates
      |
      +-- subprocess --> scripts/scan-secrets.mjs --all   credential rules, one source, clean exit
      +-- disclosure rules --> absolute home paths, Windows user-directory paths,
                               private host names, personal account identifiers

maintainer --edits--> presence.json --then--> docs/agents/ecosystem-presence.md (status + verification date)
```

### 4.3 Interface & Protocol Contracts
`presence.json`, trimmed to the decision-rich fields:

```json
{
  "positioning": { "en": "one factual sentence", "zh": "同义中文一句" },
  "packageDescription": "one factual sentence",
  "keywords": ["outcome-term"],
  "firstScreen": {
    "en": { "demoRef": "./assets/canvas-demo.png", "demoMaxLine": 0, "anchor": "## Canvas" },
    "zh": { "demoRef": "./assets/canvas-demo-zh.png", "demoMaxLine": 0, "anchor": "## 看板" }
  },
  "assets": { "assets/<name>.png": { "format": "png", "minBytes": 0, "maxBytes": 0 } },
  "catalogs": [
    {
      "id": "<catalog identifier>",
      "requirement": "submission mechanism and requirement",
      "submittedCopy": "verbatim copy submitted",
      "submissionRef": "reference when one exists",
      "status": "<current state>",
      "lastVerified": "YYYY-MM-DD"
    }
  ]
}
```

Contract rules:
1. `positioning.en` and `positioning.zh` carry the same claim; neither is a weaker translation.
2. `keywords` holds at least eight unique lowercase hyphenated outcome terms, not internal vocabulary.
3. Every entry in `assets` satisfies `0 < minBytes < maxBytes` and names a repository-relative path.
4. `firstScreen` anchors name the section that must sit within the declared line offset of the rendered document.
5. Every entry in `catalogs` carries a non-empty identifier, requirement and status, and a `lastVerified` that matches `YYYY-MM-DD` and parses as a date.
6. `docs/agents/ecosystem-presence.md` carries one section per catalog and repeats the same six fields plus the refresh procedure.

### 4.4 Amendment to ADR-0009 Section 4.2
ADR-0009 section 4.2 fixes the user-facing document structure as: Hero & Tagline, Overview, Installation, Scenarios, Canvas, Tools, Comparison, Config, Architecture, Compatibility, License. This record amends the ordering requirement only.

The collaboration canvas demonstration and a concrete two-session scenario may appear on the first screen, ahead of the Overview section, when the manifest's first-screen anchor placement is satisfied. The canvas section keeps its content contract from ADR-0009: a read-only topology showcase with an authentic, sanitized demonstration captured from a real session.

Everything else stands unchanged. The section inventory, the horizontal divider cadence, the hero slot, Installation, Scenarios, Tools, Comparison, Config, Architecture, Compatibility and License remain as specified; the invariants in section 4.1 remain in force, specifically zero emoji, Chinese subheadings of at most four characters, plain technical language, architectural separation, ecosystem modesty and agent enforcement; the revision in section 4.3 remains in force. This amendment changes placement and priority, not tone, sanitization or structural parity. ADR-0009 keeps its Accepted status as amended here.

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Benefit 1**: One edit point. Catalog copy, repository metadata and the first screen derive from one manifest instead of drifting across four hand-edited places.
- **Benefit 2**: Drift, budget violations and disclosure become pipeline failures with artifact names in the message, so a regression is caught before a reader sees it.
- **Benefit 3**: Registration is reproducible. Each catalog records its submission mechanism, verbatim copy, reference, status and verification date.
- **Benefit 4**: The first screen can lead with the demonstration while the restrained documentation decision keeps its tone and structural guarantees.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Tradeoff 1**: A copy change now touches the manifest and must keep the suite green.
  - *Mitigation*: The gate message names the artifact and the violated contract, so the fix does not require reading test source.
- **Tradeoff 2**: One more tracked artifact and one more test module to maintain.
  - *Mitigation*: The module reuses the existing static-integrity shape and asserts observable artifacts only, with no production seam.
- **Tradeoff 3**: The gate can verify agreement and budgets, not persuasion. Copy can be consistent and still weak.
  - *Mitigation*: Catalog entries and the registry are reviewed by hand before publication, and the no-superlative discipline stays in force.
- **Tradeoff 4**: A tightened asset budget forces recompression of an already published asset.
  - *Mitigation*: Budgets live in the manifest, so the ceiling is explicit and the encoding decision is reviewed there rather than inside the test.

### 5.3 Neutral & Operational Shifts
- A release that changes positioning must update the manifest, then the registry, then run the suite; the order is fixed by the contract.
- Catalog submissions stay manual and external. The maintainer confirms remote state and records the verification date; the build never fetches remote catalog state.
- Registration status can legitimately lag the manifest while a submission is pending; the gap is made visible rather than hidden.
- The demonstration capture remains a human task on a live host; the contract constrains the capture, it does not produce it.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Static Contract Tests** (`tests/public-surface-integrity.test.mjs`): manifest completeness; asset existence, format signature and byte budget; agreement between the `package.json` description and keywords and the manifest; first-screen anchor placement in both language documents; bilingual parity of the positioning claim; catalog record structure with a parseable verification date.
- **Sanitization**: `scripts/scan-secrets.mjs --all` invoked as a subprocess and required to exit clean, so credential rules keep one source; plus disclosure rules over tracked documentation and manifests for absolute home paths, Windows user-directory paths, private host names and personal account identifiers.
- **Documentation Invariants**: zero emoji, Chinese subheadings of at most four characters, and equal level-2 heading counts across `README.md` and `README_ZH.md`.
- **ADR Governance** (`tests/adr-integrity.test.mjs`): continuous numbering, index-to-disk one-to-one alignment and template-required sections.
- **Network Policy**: remote catalog state is deliberately not tested over the network; the build stays deterministic and offline.

### 6.2 Code Review & Maintenance Checklist
- [ ] Positioning changed in `presence.json` before any document or catalog entry was edited.
- [ ] Both language claims assert the same thing, with no weaker translation.
- [ ] Every added asset declares a format and a byte floor and ceiling, and stays inside them.
- [ ] Catalog records carry an identifier, a mechanism, verbatim submitted copy, a reference when one exists, a status and a fresh verification date.
- [ ] The registry repeats the manifest values and contains no personal account identifiers or developer-local paths.
- [ ] No paid placement, star solicitation or coordinated engagement was introduced.

---

## 7. Status History & Related Artifacts

- **2026-10-16**: Proposed by the maintainer following the ecosystem presence specification.
- **2026-10-16**: Accepted with the public surface manifest, the integrity gate and the presence registry.
- **Related ADRs**:
  - Amends: ADR-0009 section 4.2
  - Related to: ADR-0022, ADR-0020, ADR-0012
- **Implementation Artifacts**:
  - Primary source: `presence.json`
  - Test suite: `tests/public-surface-integrity.test.mjs`
  - Registry: `docs/agents/ecosystem-presence.md`
  - Reused scanner: `scripts/scan-secrets.mjs`
  - Note: the metadata and first-screen placement assertions land with the first-screen copy change.
