# Documentation

This repository follows Matt Pocock's single-context engineering layout.

## Where things live

- **Domain Glossary (SSOT)**: [`CONTEXT.md`](../CONTEXT.md) at the repository root defines the project's ubiquitous language, concepts, and avoided synonyms.
- **Architectural Decision Records (ADRs)**: [`adrs/`](./adrs/) records significant, permanent, and hard-to-reverse architectural decisions and invariants.
- **Agent Skill Configurations**: [`agents/`](./agents/) provides consumption contracts for automated engineering skills (issue tracker, triage labels, and domain consumption rules).
- **System Architecture Topology**: [`architecture/`](./architecture/) provides verifiable system topology specifications and offline interactive diagrams.

## Ephemeral Artifacts

- **Specifications and PRDs**: Functional requirements are ephemeral. Author them via `/to-spec`, publish to the issue tracker (or scope under `.scratch/specs/` for offline workflows), execute test-first via `/tdd`, and review before closing.
- **Reviews and Reports**: Ephemeral findings, debugging scratchpads, and audit reports live strictly under `.scratch/`, keeping versioned documentation clean.
