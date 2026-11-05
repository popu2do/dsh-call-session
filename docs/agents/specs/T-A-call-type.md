# T-A · Single source of truth for call types; header reports the real type

**Depends on:** none
**Blocks:** T-G

## Problem

A real session received `[From: session-3bc3a50c-… (根据Issue结论推进工单) | CallType: task_dispatch]`.
The type on the wire does not match the type the caller passed, and the plugin silently rewrites it in three places.

## Required behaviour

1. `lib/native-message-transport.mjs` holds a single enumeration of `notice | task_soft | task_hard | task_report`. What leaves the module is the array `CALL_TYPES`; the intent-marker map that feeds the header stays private, so nothing outside can mistake it for an array.
2. `buildTransportPayload` never substitutes a different type on the wire. An unknown `callType` throws `[InvalidParameter]` rather than degrading to `task_soft`; an omitted one falls back to `DEFAULT_CALL_TYPE` (`task_soft`), the single default that `session_call` and `session_create` share.
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
- `grep -rn "TASK_DISPATCH\|task_dispatch" lib/ index.mjs types/ tests/` returns only negative assertions: the rejection cases in `tests/report-obligation.test.mjs`, `tests/native-message-transport.test.mjs` and `tests/boundary-exploration.test.mjs`, plus the no-raw-enum guard in `tests/client.test.mjs`.
- `npm run verify` green.
