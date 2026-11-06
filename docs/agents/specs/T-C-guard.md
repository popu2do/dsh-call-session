# T-C · Turn-stopping guard: resolve session from payload, honour abort, per-turn budget

**Depends on:** T-B (blocked until the probe's evidence file exists)
**Blocks:** T-G

## Problem

The guard reads `{ agent }` from the hook payload, but the host contract is `{ turn, signal }` — the session id is therefore never resolved and the handler returns early. It also ignores `signal.aborted`, so a user-interrupted turn could be chased, and its budget is keyed per task rather than per turn.

T-B decides **where** the guard attaches. If the probe shows `agent/turn-stopping` never fires on the prose path, this ticket must pick a different seam and say why.

## Required behaviour

1. The session is resolved from the real payload shape proven by T-B. No reliance on a field the host does not send.
2. If `signal.aborted` is true the guard returns immediately and steers nothing.
3. Only sessions with a pending `task_hard` are chased; `task_soft` and `notice` never are.
4. The chase is a `steer` of a localised model-facing message that names the caller(s) and asks for `session_call(call_type='task_report')`.
5. Budget: at most 3 chases per turn, reset when the turn changes. On exhaustion the guard logs a warning containing the session id and the pending count, and lets the turn close.
6. When the pending `task_hard` is settled, no further chase happens.
7. The guard is drivable in isolation: a test can invoke it with a payload of the real shape and observe the steer.

## Seams

- `tests/report-obligation.test.mjs` — drive the handler with `{ turn, signal }` plus whatever T-B proved carries the agent; assert the steered text and the budget behaviour across turns.
- Assert on observable effects only (steer called with text, warning logged), never on counter internals.

## Definition of done

- Red→green evidence for each numbered item.
- The test payload shape matches T-B's recorded evidence, and the test file links to the evidence file.
- `npm run verify` green.
