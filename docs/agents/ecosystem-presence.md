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
| Description | Applied. `presence.json` `packageDescription`, verbatim. |
| Topics | Applied. The same ten terms as `presence.json` `keywords`. The host returns them in its own alphabetical order rather than the manifest order, so this row asserts the set, not the sequence. |
| Social preview | `pending`. The REST API does not set this field; it needs the repository settings page and an uploaded image. |
| Verified | Description and topics applied and re-read from the host on 2026-10-16. Social preview not yet set. |

Intent values, quoted from `presence.json`:

> Multi-session collaboration for DeepSeek Harness: peer session calls, a shared blackboard, and a read-only topology canvas.

> deepseek-harness, dsh-plugin, multi-session, multi-agent, agent-collaboration, task-handoff, shared-blackboard, session-call, peer-session, cordis-plugin

Pending action: set only the social preview image, through the repository settings page, then record its application date here and in `presence.json` `repository.socialPreview.verifiedOn`. `assets/canvas-demo.png` is the natural candidate, since it is the artifact the positioning sentence points at.

Two claims in this document are review items, not gate items: the semantic fitness of the discovery terms, namely whether a prospective user would search them, and the parity of the English and Chinese claims. The gate checks only that the terms are unique lowercase hyphenated strings and that both language claims are present verbatim.

## awesome-dsh-plugin

Curated catalog where this repository is listed, in category `session`. The entry file is `data/plugins/popu2do__dsh-call-session.yml`. At verification the catalog held 5065 entry files and its generated README was 1.7 MB, with this row near line 2169, so the row is an existence proof carrying one line of description rather than a discovery channel: a reader arrives by search or by scrolling, not by browsing.

| Field | Value |
| :--- | :--- |
| Identifier in `presence.json` | `awesome-dsh-plugin` |
| Submission mechanism | One YAML entry per plugin in the catalog's `data/plugins` collection. The entry `url` must match this repository and `description.en` is required. |
| Submitted copy | Recorded verbatim below, and rendered by the catalog. |
| Submission reference | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7593, merged 2026-10-17. |
| Status | `listed`. The submitted copy is published. |
| Verified | 2026-10-17. The merged entry file and the generated catalog README were both read from the host on this date. |
| Refresh | Re-read the listed entry, compare `description.en` with `presence.json` `catalogs[0].submittedCopy`, then update `presence.json` and this row and run `npm run verify`. |

Copy published, verbatim, and recorded in `presence.json`:

> Run several DeepSeek Harness sessions side by side, hand work from one to another, and watch the whole collaboration on one read-only canvas.

Line the catalog rendered before the merge, kept only as the record of what the submission replaced:

> In-process cross-session communication, peer session creation, and shared blackboard for DeepSeek Harness.

No pending action.

## dsh-plugin-radar

Ecosystem radar. It held no record of this repository at the time of writing, and a registration is now under review. The radar collects most of its entries automatically from repositories carrying the `dsh-plugin` topic, so a registration row buys a durable, human-curated entry rather than first discovery.

| Field | Value |
| :--- | :--- |
| Identifier in `presence.json` | `dsh-plugin-radar` |
| Submission mechanism | Community registration through the catalog repository's `PLUGINS.md` form. |
| Submitted copy | Recorded verbatim below, as submitted in the row added to `PLUGINS.md`. |
| Submission reference | https://github.com/AdamPlatin123/dsh-plugin-radar/pull/959, open and awaiting review. |
| Status | `submitted`. Nothing is published by this catalog yet. |
| Verified | 2026-10-16. The open submission and the remote `PLUGINS.md` were both read from the host on this date. |
| Refresh | Submit the `presence.json` positioning sentence through the `PLUGINS.md` form, record the resulting reference and date in `presence.json`, mirror them here, then run `npm run verify`. |

Copy submitted, verbatim, from the manifest positioning sentence:

> 并排运行多个 DeepSeek Harness 会话，让它们互相交接任务，并在同一张只读看板上看清整场协作。

Pending action: await review of pull request 959. Its automated classifier returns the fallback category for this repository, because its rules match substrings and no rule covers session coordination, so the submitted category was chosen by hand from the catalog's own boundary rules and the reasoning is stated in the request. On merge, set the status to `listed` and re-read the rendered row.
