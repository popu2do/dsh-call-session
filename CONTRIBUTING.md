# Contributing to dsh-call-session

Thanks for looking at this. Bug reports with a reproducible session state, host service compatibility fixes, and canvas layout or routing tests are the most useful contributions.

## Set up

Requires Node.js `>= 20.0.0`, npm `>= 10.0.0`, and Git `>= 2.30.0`.

```bash
git clone https://github.com/popu2do/dsh-call-session.git
cd dsh-call-session
npm install
```

`npm install` runs `scripts/install-hooks.mjs`, binding `core.hooksPath` to `.githooks/`.

```bash
npm run verify      # Combined syntax check (npm run lint) and full test suite (npm test)
npm run typecheck   # TypeScript declaration contract check against types/index.d.ts
npm pack --dry-run  # Verify published tarball matches package.json#files
```

The test suite (`tests/run-all.mjs`) executes every `tests/*.test.mjs` file via `node --test`. It verifies real Cordis container activation against `@deepseek-ai/dsh` (`tests/cordis-activation.test.mjs`), bilingual locale parity (`tests/i18n.test.mjs`), ADR numbering and index bidirectional alignment (`tests/adr-integrity.test.mjs`), domain vocabulary compliance (`tests/context-vocabulary.test.mjs`), and public surface sanitization (`tests/public-surface-integrity.test.mjs`).

To test in a live DeepSeek Harness instance, register the local checkout in `cordis.patch.yml` and restart `dsh web` after changing backend ESM modules (`index.mjs`, `lib/*.mjs`).

`assets/canvas-demo.gif` and `assets/mention-demo.png` are deterministic showcase artifacts rendered by `tests/helpers/render-canvas-demo.mjs` and `tests/helpers/render-mention-demo.mjs`, guarded by byte budgets in `presence.json`.

## What a good change looks like

- **Adding or changing a collaboration tool (`session_*`, `board_*`)**:
  1. Update the JSON Schema and handler registration in `lib/tools-registry.mjs`.
  2. Keep runtime state transitions in `lib/session-gateway.mjs`, `lib/blackboard-store.mjs`, or `lib/call-ledger.mjs`.
  3. Export matching TypeScript definitions in `types/index.d.ts`.
  4. Add unit and contract tests in `tests/` and verify `npm run typecheck` passes.

- **Adapting to DSH host services or lifecycle hooks**:
  1. Route all Cordis container service lookups through `readHostService` and `readProperty` in `lib/host-services.mjs`, and session operations through `lib/session-gateway.mjs`.
  2. Add a regression test in `tests/cordis-activation.test.mjs` or `tests/session-gateway.test.mjs` covering both active host services and graceful degradation when optional services are absent.

- **Changing the Collaboration Canvas or `@` Peer Session Mention UI**:
  1. Update the client bundle (`lib/client.js`, `lib/mention-picker.js`) and keep styles scoped to the plugin container.
  2. Add `zh-CN` and `en-US` strings to `lib/locales/table.mjs` so `tests/i18n.test.mjs` passes with zero missing keys.
  3. Run `tests/canvas-ui.test.mjs`, `tests/peer-session-mention.test.mjs`, and the demo asset tests (`tests/canvas-demo-asset.test.mjs`, `tests/mention-demo-asset.test.mjs`).

- **Updating public documentation or positioning copy**:
  1. `presence.json` is the single source of truth for positioning claims, discovery keywords, and asset byte budgets (ADR-0033).
  2. Keep `README.md` and `README_ZH.md` structurally aligned: identical level-2 (`##`) heading counts, zero emoji, and Chinese subheadings of at most 4 characters (ADR-0009).
  3. Avoid synonyms listed under `_Avoid_` in `CONTEXT.md` (enforced by `tests/context-vocabulary.test.mjs`).

## Rules that keep the plugin honest

- **Non-strict host probing (ADR-0037)**: Never access `ctx[name]` directly on a Cordis context proxy when probing optional services (`agent`, `web`, `tools`, `chatHistory`). Direct indexing triggers `Context Strict Probing` warnings; always use `Reflect.get` via `lib/host-services.mjs`.
- **In-process native runtime**: The plugin runs inside the DSH Node.js process (`>= 20.0.0`) with zero external binary dependencies or child daemon processes.
- **Transport semantic header**: Cross-session calls prepend an objective metadata header (`lib/semantic-header.mjs`) and preserve the caller payload verbatim without injecting directive prompt wrappers.
- **Pure slice reference**: Selecting a session via `@` inserts a read-only `dsh-session` context slice without waking the target session or recording a call connection on the canvas.
- **Public surface sanitization**: Tracked files on the published surface (`README.md`, `README_ZH.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `DESIGN.md`, `SECURITY.md`, `presence.json`, `package.json`, `docs/`, and `.github/`) must never contain credentials, Unix/Windows home directory paths, or RFC1918/internal hostnames (enforced by `scripts/scan-secrets.mjs` and `tests/public-surface-integrity.test.mjs`).
- **Architectural Decision Records**: Changes that alter tool schemas, persistence formats, or host integration contracts require a numbered ADR in `docs/adrs/` created from `docs/adrs/template.md` and indexed in `docs/adrs/README.md` (enforced by `tests/adr-integrity.test.mjs`).

## Before you open a pull request

```bash
npm run verify
npm run typecheck
node scripts/scan-secrets.mjs --all
npm pack --dry-run
```

- **Commit format**: `.githooks/commit-msg` (`scripts/check-commit-msg.mjs`) enforces Conventional Commits `<type>(<scope>): <subject>` with a 72-character header limit and no trailing period. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Pre-commit guards**: `.githooks/pre-commit` blocks accidental edits to `README.md` / `README_ZH.md` (override with `ALLOW_README=1`), `package.json` version bumps (override with `ALLOW_VERSION_BUMP=1`), and non-standard subdirectories under `docs/`.
- **Quality scorecard compatibility**: Keep `package.json` fields `dsh`, `engines.dsh` (`>=0.2.0-rc.2 <0.3.0-0`), and `peerDependencies["@deepseek-ai/dsh"]` aligned so community quality and recommendation indexers resolve the plugin cleanly.

## Reporting issues & security

- **Bugs and enhancements**: Open a GitHub Issue using the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) or [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) form. External pull requests should link an existing triaged issue.
- **Security vulnerabilities**: Report privately via [GitHub Security Advisories](./SECURITY.md) rather than a public issue.
- **Code of Conduct & License**: Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). Contributions are licensed under the [MIT License](./LICENSE).
