# T-B · Runtime probe: does the host actually dispatch `agent/turn-stopping`?

**Depends on:** none
**Blocks:** T-C (hard dependency — T-C must not be designed before this answer exists)

## Problem

The previous implementation shipped a guard that never fired, and its tests only proved that the handler was registered against a mock. Nothing ever asked the real host whether the hook runs. This ticket answers that question and nothing else.

## Required behaviour

1. Add a throwaway probe that registers an inert listener on `agent/turn-stopping` and appends one line to a log file: timestamp, agent id, turn, `signal.aborted`, and `Object.keys(payload)`.
2. Restart the host so the probe is loaded (link: mount has no HMR; see `docs/agents/domain.md`).
3. Drive a real peer session: send it a message that makes it answer in prose and end the turn (e.g. "reply 我知道了"). Record whether the listener ran.
4. Also drive a turn that ends **after a tool call**, and a turn the user aborts mid-flight. Record which of the three paths fire.
5. Write findings to `docs/agents/evidence/0020-turn-stopping.md`: payload keys observed, which paths fired, and the actual log excerpt. Raw log lines are the evidence; a prose summary alone is not.

## Seams

The probe itself is not a unit test. It is a temporary instrumentation commit that must be reverted once the evidence file exists.

## Definition of done

- `docs/agents/evidence/0020-turn-stopping.md` exists and quotes raw log lines.
- The file states plainly either "hook fires on path X" or "hook does not fire on path X".
- If the hook does not fire on the prose-only path, T-C's design must change and this ticket says so explicitly.
