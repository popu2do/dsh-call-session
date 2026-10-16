# Ecosystem Presence Registry

Registration state for every ecosystem catalog that can carry this plugin. `presence.json` is the single authored source for positioning copy, discovery keywords, first-screen anchors and asset budgets; this document is the operational record that lets the next maintainer re-run a submission instead of rediscovering it. Copy is edited in `presence.json` first, then this registry is updated, then the suite is run.

## Scope

- In scope: discoverability and comprehension, catalog registration and metadata alignment.
- Out of scope: paid promotion, star solicitation, coordinated voting, multi-account engagement and any content on third-party social platforms. No artificial signal is bought, requested or coordinated.
- This document carries no personal account identifiers and no developer-local paths. Repository ownership is the only identity recorded.

## Refresh

1. Edit `presence.json` `catalogs[]` first: `id`, `requirement`, `submittedCopy`, `submissionRef`, `status`, `lastVerified`.
2. Confirm the remote catalog state by hand.
3. Set `lastVerified` to the date the remote state was confirmed.
4. Mirror the same values into the matching catalog section below.
5. Run `npm run verify`. The public surface integrity gate fails when a catalog record is structurally incomplete, when a date does not parse, or when a tracked file exposes a developer-local path; `scripts/scan-secrets.mjs --all` must exit clean.

Gate: `tests/public-surface-integrity.test.mjs`. Remote catalog state is never fetched by the build; the maintainer verifies it and records the date.

## Repository Metadata

Host-side settings. They are not versioned, so `presence.json` `repository` holds the intended values and this table records their verification.

| Field | Value |
| :--- | :--- |
| Description | `presence.json` `packageDescription`, verbatim. |
| Topics | `presence.json` `keywords`, verbatim and in the same order. |
| Social preview | `pending`. Not set on the host yet, pending repository authentication. |
| Verified | 2026-10-16 |

Intent values, quoted from `presence.json`:

> Multi-session collaboration for DeepSeek Harness: peer session calls, a shared blackboard, and a read-only topology canvas.

> deepseek-harness, dsh-plugin, multi-session, multi-agent, agent-collaboration, task-handoff, shared-blackboard, session-call, peer-session, cordis-plugin

Pending action: set the description, the topic list and a social preview image once repository authentication is available, then record the application date here and in `presence.json` `repository.socialPreview.verifiedOn`.

Two claims in this document are review items, not gate items: the semantic fitness of the discovery terms, namely whether a prospective user would search them, and the parity of the English and Chinese claims. The gate checks only that the terms are unique lowercase hyphenated strings and that both language claims are present verbatim.

## awesome-dsh-plugin

Curated catalog where this repository is already listed. The category carries several hundred entries, so this one line is effectively the whole discovery surface.

| Field | Value |
| :--- | :--- |
| Identifier in `presence.json` | `awesome-dsh-plugin` |
| Submission mechanism | One YAML entry per plugin in the catalog's `data/plugins` collection. The entry `url` must match this repository and `description.en` is required. |
| Submitted copy | Recorded verbatim below. |
| Submission reference | None recorded. |
| Status | `listed` |
| Verified | 2026-10-16 |
| Refresh | Re-read the listed entry, compare `description.en` with `presence.json` `catalogs[0].submittedCopy`, then update `presence.json` and this row and run `npm run verify`. |

Verbatim copy as recorded in `presence.json`:

> In-process cross-session communication, peer session creation, and shared blackboard for DeepSeek Harness.

Pending action: this listed copy predates the public surface contract and describes mechanism rather than outcome. It is to be rewritten to lead with the outcome and the canvas demonstration, then resubmitted through the same one-file mechanism. `presence.json` and this row are updated together once the new reference exists.

## dsh-plugin-radar

Ecosystem radar that currently holds no record of this repository.

| Field | Value |
| :--- | :--- |
| Identifier in `presence.json` | `dsh-plugin-radar` |
| Submission mechanism | Community registration through the catalog repository's `PLUGINS.md` form. |
| Submitted copy | None. `presence.json` records an empty `submittedCopy` because no entry has been submitted. |
| Submission reference | None. |
| Status | `not-registered` |
| Verified | 2026-10-16 |
| Refresh | Submit the `presence.json` positioning sentence for both languages through the `PLUGINS.md` form, record the resulting reference and date in `presence.json`, mirror them here, then run `npm run verify`. |

Pending action: submit the entry. The copy to submit is the manifest positioning sentence, which is the single authored source; it must not be rewritten here.
