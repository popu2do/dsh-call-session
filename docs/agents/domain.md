# Domain Docs

## Primary Sources

- **`CONTEXT.md`**: Authoritative glossary of domain terms and their `Avoid` lists. Use these exact terms in issue titles, specs, code, and tests.
- **Vocabulary enforcement**: `tests/context-vocabulary.test.mjs` reads those `Avoid` lists at runtime and fails on any tracked text file that uses an avoided name, so adding a term to `CONTEXT.md` enforces it without editing the gate.
- **`docs/adrs/`**: Architectural decision records (`0001` through `0039`), indexed in `docs/adrs/README.md` and verified by `tests/adr-integrity.test.mjs`. When a proposal conflicts with an accepted ADR, surface the conflict explicitly:
  > _Contradicts ADR-XXXX (...), worth reopening because..._

## Runtime & Distribution Constraints

- **In-process native runtime**: The plugin runs inside the DSH Node.js process (`>= 20.0.0`) with zero external binary dependencies or child daemon processes.
- **Backend ESM reload**: Backend modules (`index.mjs`, `lib/*.mjs`) load into memory when `dsh web` starts. Restart `dsh web` before running live verification of backend changes.
- **Marketplace release sync**: The plugin marketplace scrapes GitHub Release bodies daily. Include complete markdown release notes in every GitHub Release body.