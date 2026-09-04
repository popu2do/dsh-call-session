# Contributing to dsh-call-session

Thank you for your interest in contributing to `dsh-call-session`! This project provides the native, zero-dependency cross-session collaboration, in-process agent unicast calling, and public blackboard plugin for DeepSeek Harness (DSH).

We welcome contributions of all kinds: bug fixes, architectural improvements, documentation enhancements, feature proposals, and community guidance.

---

## 1. Engineering Principles & Guidelines

To maintain high software engineering standards, we adhere to strict engineering principles:

- **Zero-Trace Principle**: Code changes must look deliberately designed from day one. Avoid dead code, commented-out experiments, or extraneous temporary markers. Diff and commit history should reflect only the clean, final state.
- **Fail Fast & Root-Cause Fixes**: Never silently swallow errors; always detect boundary violations early and fix the root cause rather than patching symptoms with fragile workarounds.
- **SOLID, KISS, DRY, YAGNI**: Keep designs modular, cohesive, and minimal. Do not add speculative features or unnecessary abstractions.
- **Zero External Subprocesses**: Keep the plugin 100% native within the DSH Node.js runtime. Avoid heavy binary dependencies, external child process spawns, or background daemon sidecars.
- **Bilingual Documentation Sync**: Any user-facing feature, configuration change, or tool parameter modification **must** be documented in both **`README.md` (English)** and **`README_ZH.md` (Simplified Chinese)**.
- **Architecture Decision Records (ADRs)**: Non-trivial architectural, concurrency, storage, or protocol changes **must** include an ADR in `docs/adrs/`.

---

## 2. Architecture Decision Records (ADRs)

Before making or proposing architectural changes:
1. Consult the existing records in [`docs/adrs/`](./docs/adrs/README.md) to understand current design choices and invariants.
2. If your change modifies or introduces:
   - Tool parameter schemas or return contracts,
   - In-process dispatching or lifecycle hooks (`dispose`, `inject`),
   - Atomic persistence, locking, or self-healing strategies,
   - Public blackboard capacity or cleanup policies;
3. Copy [`docs/adrs/template.md`](./docs/adrs/template.md) to `docs/adrs/NNNN-<short-imperative-title>.md`.
4. Fill out the context, alternatives considered, tradeoffs, and compliance checks.
5. Update the ADR status matrix in `docs/adrs/README.md` and link your Pull Request to the ADR.

---

## 3. Development Environment & Setup

### Prerequisites
- **Node.js**: `>= 20.0.0` (LTS recommended)
- **npm**: `>= 10.0.0`
- **Git**: `>= 2.30.0`

### Repository Setup
```bash
# Clone the repository
git clone https://github.com/popu2do/dsh-call-session.git
cd dsh-call-session

# Install development dependencies
npm install
```

### Directory Structure
```
dsh-call-session/
├── .github/                  # GitHub Actions CI/CD workflows & issue/PR templates
│   ├── workflows/
│   │   ├── ci.yml            # Multi-OS & multi-Node test matrix
│   │   └── release.yml       # Release & NPM publishing workflow
│   ├── ISSUE_TEMPLATE/       # Structured issue forms
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/                     # Architecture Decision Records (ADRs)
│   └── adrs/                 # ADR records
├── lib/                      # Core runtime modules
│   ├── board-store.mjs       # Debounced atomic storage & self-healing
│   ├── session-call.mjs      # Strict unicast dispatch & anti-ambiguity fuse
│   └── session-query.mjs     # Workspace-scoped two-state session query
├── types/                    # TypeScript ambient declarations
│   └── index.d.ts            # Public API & tool parameter contracts
├── tests/                    # Native Node.js test suites
│   ├── board-store.test.mjs  # Atomic persistence & backup recovery tests
│   ├── session-call.test.mjs # Unicast dispatch, prefix fuses & safety tests
│   ├── session-query.test.mjs# Query scoping & status normalization tests
│   └── lifecycle.test.mjs    # Cordis inject, Config schema & dispose tests
├── cordis.patch.yml          # Declarative Cordis profile patch
├── index.mjs                 # Plugin entry, Schemastery Config & tool registration
├── index.d.ts                # Root re-export for TypeScript consumers
├── tsconfig.json             # TypeScript configuration for declaration verification
├── package.json              # Package metadata, exports, and verification scripts
├── CHANGELOG.md              # Keep a Changelog & SemVer release history
├── CONTRIBUTING.md           # This contribution guide
├── SECURITY.md               # Security policy & vulnerability reporting
├── LICENSE                   # MIT License
├── README.md                 # English documentation & architecture diagrams
└── README_ZH.md              # Chinese documentation & architecture diagrams
```

---

## 4. Development & Verification Workflow

Always verify your changes locally before opening a pull request:

```bash
# 1. Check syntax across all ESM files
npm run lint

# 2. Verify TypeScript types and contracts
npm run typecheck

# 3. Run full automated unit test suites
npm test

# 4. Run test suites with coverage report
npm run test:coverage

# 5. Execute unified pre-flight verification (lint + test)
npm run verify

# 6. Verify packaging output purity (confirm only in-scope files are packed)
npm pack --dry-run
```

All CI checks must pass before a pull request can be merged.

---

## 5. Git & Commit Guidelines

### Branch Naming Conventions
- `feat/<feature-name>`: New features or enhancements (e.g. `feat/batch-post-support`)
- `fix/<issue-name>`: Bug fixes (e.g. `fix/windows-lock-retry`)
- `docs/<doc-name>`: Documentation improvements (e.g. `docs/bilingual-sync`)
- `refactor/<scope>`: Code refactoring without behavioral changes
- `test/<test-name>`: Adding or improving test cases
- `chore/<chore-name>`: Tooling, dependency, or workflow maintenance

### Commit Message Convention (Conventional Commits)
We enforce the [Conventional Commits](https://www.conventionalcommits.org/) standard:

```
<type>(<scope>): <short imperative summary>

[optional body explaining motivation and context]

[optional footer referencing issues, e.g. Fixes #12]
```

**Allowed Types:**
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (formatting, white-space)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to our CI configuration files and scripts
- `chore`: Other changes that do not modify `src` or test files

**Example:**
```
feat(call): add strict anti-ambiguity prefix fuse for unicast dispatch

Enforce target session IDs to have a minimum length of 8 hex characters
and refuse ambiguous matches across concurrent sessions.

Fixes #24
```

---

## 6. Submitting a Pull Request (PR)

1. **Keep PRs Focused**: One PR should address one well-defined concern or feature. Avoid large, omnibus PRs.
2. **Follow the Template**: Complete all sections in the provided [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).
3. **Verify Documentation**: Ensure both `README.md` and `README_ZH.md` are kept up to date.
4. **Clean Git History**: Rebase against the target branch (`master` or `main`) and squash intermediate "WIP" commits before review.
5. **Quality Gates**: Ensure `npm run verify` passes with zero warnings or errors.

---

## 7. Security Disclosures

If you find a security vulnerability, please do **NOT** open a public issue. Follow the reporting guidelines outlined in **[SECURITY.md](./SECURITY.md)**.

---

## 8. Licensing

By submitting a contribution to `dsh-call-session`, you agree that your contributions will be licensed under the project's **[MIT License](./LICENSE)**.
