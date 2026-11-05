# T-G · Docs: new ADR, CONTEXT.md vocabulary, CHANGELOG breaking change, legacy ADR wording

**Depends on:** T-A, T-D, T-F, T-C
**Blocks:** nothing

## Required behaviour

1. New ADR recording the four-type protocol, the ledger, the guard and its disclosed boundary. ADR follows the repo template's section structure with Chinese short headings.
2. `CONTEXT.md`: canonical terms for the four call types, pending task ledger, turn-stopping guard; each with an `Avoid` list. `tests/context-vocabulary.test.mjs` must stay green.
3. `CHANGELOG.md`: breaking change entry — `task_dispatch` removed, no alias, older plugins will reject the new types.
4. Legacy ADRs mentioning `task_dispatch` get a wording revision or an amendment note; they must not silently contradict the new protocol.
5. `README` / tool descriptions / system prompt section all describe the same four types.

## Definition of done

- `grep -rn "task_dispatch" docs/ README.md` returns only historical ADRs carrying an explicit amendment note.
- `npm run verify` green.
