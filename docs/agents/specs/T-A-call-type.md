# T-A · Single source of truth for call types; header reports the real type

**Depends on:** none
**Blocks:** T-G

## Problem

A real session received `[From: session-3bc3a50c-… (根据Issue结论推进工单) | CallType: task_dispatch]`.
The type on the wire does not match the type the caller passed, and the plugin silently rewrites it in three places.

## Required behaviour

1. `CALL_TYPE_INTENTS` in `lib/native-message-transport.mjs` is the only enumeration: `notice | task_soft | task_hard | task_report`.
2. `buildTransportPayload` never substitutes a different type. An unknown or missing `callType` must throw `[InvalidParameter]` rather than degrade to `task_soft`.
3. The `session_create` bootstrap branch passes the caller's type through; it must not hard-code `task_soft`.
4. The native message summary intent marker derives from the enumeration only; no `String(callType).toUpperCase()` fallback that can mint a literal like `TASK_DISPATCH`.
5. `executeSessionCall` still rejects unknown types with `[InvalidParameter]`; `task_dispatch` is rejected, not aliased.
6. `lib/tools-registry.mjs` JSON Schema enum and `types/*.d.ts` reference the same four values.

## Seams

- `tests/native-message-transport.test.mjs` — table-driven: for each of the four types, `buildTransportPayload(...).split('\n')[0]` must contain `CallType: <that type>` verbatim.
- `tests/report-obligation.test.mjs` — `task_dispatch` rejected at `executeSessionCall`; unknown type throws from the transport builder.
- `tests/session-create.test.mjs` — bootstrap message header carries the requested type.

## Definition of done

- New tests fail before the change and pass after (show both runs).
- `grep -rn "TASK_DISPATCH\|task_dispatch" lib/ index.mjs types/ tests/` returns only the negative assertions in `tests/report-obligation.test.mjs`.
- `npm run verify` green.
