# Documentation

This repository follows Matt Pocock's single-context engineering layout.

## Where things live

- **Domain Glossary (SSOT)**: [`CONTEXT.md`](../CONTEXT.md) at the repository root defines the project's ubiquitous language, concepts, and avoided synonyms.
- **Architectural Decision Records (ADRs)**: [`adrs/`](./adrs/) records significant, permanent, and hard-to-reverse architectural decisions and invariants.
- **Agent Skill Configurations**: [`agents/`](./agents/) provides consumption contracts for automated engineering skills (issue tracker, triage labels, and domain consumption rules).

## Where things DO NOT live

- **No Static PRDs or Design Specs**: Functional requirements are ephemeral. They are authored via `/to-spec`, published to the issue tracker (or scoped under `.scratch/specs/` for offline workflows), executed test-first via `/tdd`, and reviewed before closing.
- **No Temporary Reviews or Drafts**: Ephemeral findings, debugging scratchpads, and audit reports live strictly under `.scratch/`, never in this directory.
