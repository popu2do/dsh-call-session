# Issue Tracker: GitHub

Issues and specs live in GitHub Issues. Run `gh` inside the repository clone so it resolves the remote automatically.

## Operations

- **Create**: `gh issue create --title "..." --body "..."` (use a heredoc for multi-line bodies).
- **Read**: `gh issue view <number> --comments`.
- **List**: `gh issue list --state open --json number,title,body,labels,comments` with `--label` filters.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Label**: `gh issue edit <number> --add-label "..." --remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

## Triage Surface

- **PRs as a request surface: no.** Triage operates exclusively on GitHub Issues; external pull requests implement existing triaged issues.

## Wayfinding Operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as decision tickets.

- **Map**: Issue labelled `wayfinder:map`, holding Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket**: Sub-issue linked to the map (or listed in the map task list with `Part of #<map>` in the child body), labelled `wayfinder:<type>` (`research`, `prototype`, `grilling`, `task`).
- **Blocking**: Native GitHub issue dependencies via `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` (numeric database id from `gh api repos/<owner>/<repo>/issues/<n> --jq .id`), or `Blocked by: #<n>` at the top of the child body.
- **Frontier query**: Open child issues of the map with zero open blockers and no assignee, in map order.
- **Claim**: `gh issue edit <n> --add-assignee @me`.
- **Resolve**: Post the answer with `gh issue comment <n> --body "<answer>"`, close with `gh issue close <n>`, and append a one-line gist with link to the map's `Decisions so far` section.
