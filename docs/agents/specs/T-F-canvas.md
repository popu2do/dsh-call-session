# T-F · Canvas: active/settled edges, hard vs soft distinction, zh/en copy

**Depends on:** none
**Blocks:** T-G

## Problem

An unsettled obligation and a settled one must look different, and `task_hard` must be visually distinguishable from `task_soft`. The current client hard-codes `isTaskObligation` in two places and its i18n map has to stay in step with the enumeration.

## Required behaviour

1. `task_soft` / `task_hard` call records keep full opacity and continuous flow animation while `status === 'active'`; once `settled`, they decay like any historical call.
2. `task_hard` uses its own colour and arrow marker; `task_report` and `notice` keep their existing distinct markers.
3. Drawer and tooltip copy for all four types is localised in both `zh` and `en`. The labels live once, in `lib/locales/table.mjs`, and reach the bundle through the generated region, so the browser never paints a raw enum value.
4. Frontend dictionary keys and the backend enumeration cannot drift: a test asserts every backend call type has a frontend label in both locales.

## Seams

- `tests/client.test.mjs` — render the canvas with a mixed fixture and assert edge class names, colours, marker ids and label text.
- `tests/i18n.test.mjs` — key parity zh↔en and coverage of all four call types.
- `tests/canvas-locale-embed.test.mjs` — the shipped bundle carries no placeholder token and its locale region matches the source table line for line.

## Definition of done

- Red→green evidence.
- `npm run verify` green.
