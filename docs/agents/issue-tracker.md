# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create**: `gh issue create --title "..." --body "..."` (heredoc for multi-line).
- **Read**: `gh issue view <number> --comments`
- **List**: `gh issue list --state open` with appropriate `--label` filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Label**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` resolves it automatically.

## Triage Surface

- **PRs as request surface**: **no**. External PRs are not treated as feature requests.

## Wayfinding Operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: Single issue labelled `wayfinder:map`.
- **Child ticket**: Sub-issue linked to map with label `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Native GitHub dependencies via `gh api repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by`. Fall back to `Blocked by: #<n>` header.
- **Frontier query**: Open children with zero open blockers and no assignee.
- **Claim & Resolve**: `gh issue edit <n> --add-assignee @me` to claim; close and append decision to map upon resolve.
