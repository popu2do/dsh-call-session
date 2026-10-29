## What this changes

<!-- Problem statement, architectural context, and summary of the change. -->

## Related issue or ADR

<!-- Link the triaged issue and any relevant ADR in docs/adrs/: Fixes #123 -->
Fixes #

## Affected surfaces

- [ ] Collaboration tools / runtime state (`lib/tools-registry.mjs`, `lib/session-gateway.mjs`, `lib/blackboard-store.mjs`)
- [ ] DSH host gateway / Cordis lifecycle (`index.mjs`, `lib/host-services.mjs`)
- [ ] Collaboration Canvas / `@` Peer Session Mention UI (`lib/client.js`, `lib/mention-picker.js`, `lib/locales/table.mjs`)
- [ ] Public documentation / presence manifest (`README.md`, `README_ZH.md`, `presence.json`, `docs/adrs/`)

## Checks

- [ ] `npm run verify` passes (`npm run lint` + `npm test`)
- [ ] `npm run typecheck` passes (`types/index.d.ts` aligned)
- [ ] `node scripts/scan-secrets.mjs --all` passes with zero findings
- [ ] `npm pack --dry-run` confirms published tarball contents
