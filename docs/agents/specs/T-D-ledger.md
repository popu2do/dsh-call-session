# T-D · Pending task ledger: record on delivery, FIFO settle, archive cascade, context injection

**Depends on:** none
**Blocks:** T-G

## Problem

The obligation chain has to be observable by the model itself. Today the ledger exists but its boundaries are untested: there is no test that a task is enqueued only after a successful delivery, no test for the settle pairing edge cases, and the injected reminder text is not asserted against the real provider shape.

## Required behaviour

1. Enqueue happens **after** dispatch succeeds, never when the message object is constructed.
2. A `task_report` settles exactly one entry: the oldest entry with the same caller↔target pair. It also flips the matching call record to `settled`.
3. A `task_report` with no matching entry is a no-op: no throw, no ledger damage.
4. `notice` never enqueues. `task_soft` and `task_hard` both enqueue and record their type.
5. Session archive / remove / dispose cascades cleanup for both sides of the pair.
6. `systemPrompt.context` provider registered by `apply()` returns an empty string when the session has no pending tasks, and otherwise mentions the count and the caller title(s). Text is localised, zh and en symmetric.
7. The provider resolves the session from the `agent` the host passes to `systemPrompt.context`.

## Seams

- `tests/report-obligation.test.mjs` — ledger behaviour through the public telemetry API and the registered context provider; assert the model-facing string, not private arrays.
- `tests/call-connection.test.mjs` — settled status visible in the canvas snapshot.

## Definition of done

- Red→green evidence for each numbered item.
- No assertion on private field names such as `_pendingTasks`.
- `npm run verify` green.
