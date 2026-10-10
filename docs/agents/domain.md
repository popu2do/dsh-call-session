# Domain Docs

How engineering skills consume this repo's domain documentation.

## Primary Sources

- **`CONTEXT.md`**: Single source of truth for domain concepts and forbidden terms (`Avoid` list).
- **`docs/adrs/`**: Immutable technical decisions. If an approach contradicts an ADR, surface it explicitly:
  > _Contradicts ADR-XXXX (...), but worth reopening because…_

## Host & Distribution Lifecycles

- **Backend ESM caching**: Backend plugins (`lib/*.mjs`, `index.mjs`) are loaded into memory at `dsh web` startup. Live verification of backend changes requires restarting `dsh web`.
- **Marketplace release sync**: The plugin marketplace probes GitHub Release bodies daily. Releases must carry complete markdown notes in the GitHub Release body.
