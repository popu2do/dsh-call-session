# Contributing to dsh-call-session

## Issues & Proposals

GitHub Issues are the single request surface for this repository. External pull requests implement an existing triaged issue labeled `ready-for-agent` or `ready-for-human`.

- **Bug reports**: Open a [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) with the runtime environment, reproducible session state, and observed tool return values or canvas behavior.
- **Feature requests**: Open a [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) using canonical terms from [CONTEXT.md](CONTEXT.md). Check [docs/adrs/README.md](docs/adrs/README.md) before proposing contract changes; when a proposal contradicts an accepted ADR, state the conflict explicitly (`Contradicts ADR-XXXX, worth reopening because...`).
- **Security & conduct**: Report vulnerabilities privately via [SECURITY.md](./SECURITY.md). Participation follows the [Code of Conduct](./CODE_OF_CONDUCT.md) under the [MIT License](./LICENSE).

## Coding Standards

- **Domain vocabulary**: Use canonical terms from [CONTEXT.md](CONTEXT.md) across code, tests, documentation, and commit messages. `tests/context-vocabulary.test.mjs` enforces the `_Avoid_` list across tracked files.
- **Host gateway seam (ADR-0037)**: Probe optional Cordis services (`agent`, `web`, `tools`, `chatHistory`) through `readHostService` and `readProperty` in `lib/host-services.mjs` (`Reflect.get`), route host session operations through `lib/dsh-host-gateway.mjs`, and degrade gracefully when optional services are absent.
- **In-process native runtime**: Execute entirely within the DSH Node.js process (`>= 20.0.0`) with zero external binary dependencies or child daemon processes.
- **Transport & reference boundaries**: Prepend the transport semantic header via `buildTransportPayload` in `lib/native-message-transport.mjs` on cross-session calls and preserve the caller payload verbatim without directive wrappers. Keep `@` peer session mentions as read-only `dsh-session` context slices with zero target wakeups and zero canvas call connections.
- **Scoped UI & bilingual parity**: Scope Collaboration Canvas styles inside `.dsh-canvas-container` ([DESIGN.md](DESIGN.md)), and register matching `zh-CN` and `en-US` entries in `lib/locales/table.mjs`.
- **Contracts, tests & ADRs**: Drive behavior changes test-first in `tests/*.test.mjs` and keep `types/index.d.ts` aligned with tool schemas. Record changes to tool schemas, persistence formats, or host integration contracts as a numbered ADR in `docs/adrs/` (created from `docs/adrs/template.md` and indexed in `docs/adrs/README.md`).
- **Public surface integrity (ADR-0033)**: Edit positioning copy, discovery keywords, and showcase asset byte budgets in `presence.json` first. Keep `README.md` and `README_ZH.md` structurally aligned (identical `##` heading counts, zero emoji, Chinese subheadings `<= 4` characters), and keep published surface files free of credentials, local home paths, and private hostnames.

## Setup, Verification & Git Hooks

Requires Node.js `>= 20.0.0`, npm `>= 10.0.0`, and Git `>= 2.30.0`.

```bash
npm install                        # Installs dependencies and binds core.hooksPath to .githooks/
npm run verify                     # Syntax check (npm run lint) and full test suite (npm test)
npm run typecheck                  # TypeScript declaration contract check against types/index.d.ts
node scripts/scan-secrets.mjs --all
npm pack --dry-run
```

- **Live host verification**: Backend ESM modules (`index.mjs`, `lib/*.mjs`) load into memory when `dsh web` starts; restart `dsh web` before verifying backend changes in a live DeepSeek Harness instance.
- **Commit message gate**: `.githooks/commit-msg` enforces Conventional Commits `<type>(<scope>): <subject>` (`<= 72` characters, no trailing period; allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`).
- **Pre-commit guards**: `.githooks/pre-commit` runs secret scanning and `npm run verify`, locks `README.md` / `README_ZH.md` (`ALLOW_README=1` to override) and `package.json` version edits (`ALLOW_VERSION_BUMP=1` to override), restricts `docs/` paths to `docs/{adrs,agents,architecture}/` and `docs/README.md`, and keeps all verification scripts in `tests/*.test.mjs` rather than `scripts/`.
