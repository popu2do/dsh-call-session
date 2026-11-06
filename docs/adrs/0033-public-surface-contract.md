<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
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
1. **Manifest Single Source Invariant**: `presence.json` is the only authored place for the English and Chinese positioning copy, the discovery keyword set, the package description, the repository description and topics, the social preview intent, first-screen anchors and asset budgets. Positioning copy, `packageDescription`, the repository metadata, the first-screen values and the asset budgets are strictly derived values and the gate asserts them verbatim. A catalog `submittedCopy` is a different kind of value: it records, verbatim, the copy most recently submitted to that catalog, so it may legitimately differ from the manifest and may be ahead of what the catalog currently renders while a submission is under review; the registry records which of the two states each catalog is in. The gate asserts its structure and its non-emptiness, never its equality with the manifest.
2. **Integrity Gate Invariant**: one static test module in the existing suite fails the build when a tracked public artifact drifts from the manifest, when an asset violates its byte budget or format signature, or when a tracked file exposes environment-specific information. No production module changes and no runtime seam are introduced.
3. **Two-Halves Sanitization Invariant**: credential detection is delegated to the existing scanner invoked in whole-repository mode as a subprocess and must exit clean, so credential rules keep one source. The gate itself enforces exactly four disclosure rule classes: a Unix absolute home directory path; a Windows user-directory path; a private host name, meaning a full four-octet RFC1918 IPv4 address or a host name ending in `.internal` or `.local`; and a personal account identifier, meaning an e-mail address shape or an at-handle mention. The first three classes cover the whole published surface: the nine root documents and manifests, every file under `docs/`, and every file under `.github/`. That surface is enumerated from the Git index, so it is exactly the tracked published set and an ignored local artifact can never enter it. The fourth covers the two records where an identity would be written, the catalog records in `presence.json` and the registry document. `tests/` and `lib/` are out of the scan set by design: they carry synthetic fixtures, including a fake user directory path, while the gate subject is the published surface rather than the source tree.
4. **Asset Budget Invariant**: every declared asset declares a format and a byte floor and ceiling. The gate asserts existence, format signature and byte range, so first-screen weight cannot grow silently.
5. **Registry Operational Invariant**: `docs/agents/ecosystem-presence.md` records, per catalog, the identifier exactly as it appears in the manifest, the submission mechanism and requirement, the verbatim submitted copy, the submission reference, the status, the verification date and the refresh procedure. It also records the intended repository metadata, the description, the topics and the social preview, with their pending state and verification date. The manifest's catalog records are asserted structurally by the gate; the registry document and the external submissions are reviewed by hand before publication.
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
      +-- asserts --> presence.json              manifest completeness, repository metadata intent,
      |                                           catalog record structure, dates, hero binding
      |
      +-- subprocess --> scripts/scan-secrets.mjs --all   credential rules, one source, clean exit
      +-- disclosure rules --> published surface: Unix home paths, Windows user-directory
                               paths, private host names
      +-- disclosure rules --> catalog records and registry: personal account identifiers

maintainer --edits--> presence.json --then--> docs/agents/ecosystem-presence.md (status, metadata and verification date)
```

### 4.3 Interface & Protocol Contracts
`presence.json`, trimmed to the decision-rich fields:

```json
{
  "positioning": { "en": "one factual sentence", "zh": "同义中文一句" },
  "packageDescription": "one factual sentence",
  "keywords": ["outcome-term"],
  "repository": {
    "description": "the package description, verbatim",
    "topics": ["every keyword, verbatim"],
    "socialPreview": { "status": "<pending or set>", "verifiedOn": "YYYY-MM-DD" }
  },
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