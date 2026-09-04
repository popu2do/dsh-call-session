# dsh-call-session

<p align="center">
  In-process cross-session communication and workspace shared blackboard for DeepSeek Harness (DSH)
</p>

<p align="center">
  <a href="https://github.com/popu2do/dsh-call-session/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="./docs/adrs/README.md"><img src="https://img.shields.io/badge/ADR-Standard-green.svg" alt="ADR Architecture" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933.svg?logo=node.js&logoColor=white" alt="Node.js Version" /></a>
  <a href="https://cordis.moe"><img src="https://img.shields.io/badge/Cordis-v4.x-purple.svg" alt="Cordis" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript Strict" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_ZH.md">简体中文</a>
</p>

## Overview

dsh-call-session is a plugin for DeepSeek Harness (DSH) providing in-process cross-session messaging and state sharing.

When multiple agent sessions run concurrently, the plugin provides two modes of collaboration:
- Unicast calls: Send 1:1 directives or status reports between independent sessions. Automatically adapts to target state via running steering (`steer`) or idle wakeup (`followup`).
- Shared blackboard: Maintain a workspace-isolated store to post and retrieve milestones, shared state, or large contexts on demand without passive wakeups.

## Install

```bash
# Add to the target profile (e.g. web)
dsh plugin --profile web add dsh-call-session

# List installed plugins
dsh plugin --profile web list

# Remove plugin
dsh plugin --profile web remove dsh-call-session
```

> Note: The `--profile` option must follow the `plugin` subcommand (e.g., `dsh plugin --profile web ...`).

## Usage

### Unicast Call

Send directives or reports to another session using `session_call`. The plugin resolves target sessions in-process and injects native notifications:

```json
{
  "name": "session_call",
  "arguments": {
    "target_session_id": "session-be7d7578b0fe",
    "call_type": "task_dispatch",
    "message": "Please review export specifications in types/index.d.ts."
  }
}
```

### Shared Board

Post shared data or milestone results with `board_post` to obtain a unique `postId`. Other sessions query entries on demand via `board_list` without unexpected wakeups:

```json
{
  "name": "board_post",
  "arguments": {
    "topic": "task:audit",
    "content": "Security audit completed. No vulnerabilities found.",
    "tags": ["audit", "passed"]
  }
}
```

### Collaboration Mode

For large payloads (such as verbose test logs, audit reports, or code changes), use the two-phase collaboration flow:
1. The sender posts the bulky payload using `board_post` and receives a `postId`.
2. The sender calls `session_call` with a concise directive, referencing the `postId` in `context_post_ids`.
3. The recipient receives the directive and retrieves the full content on demand using `board_list`.

## Tools

| Name | Type | Mode | Description |
| :--- | :--- | :--- | :--- |
| `session_call` | Tool | Push | 1:1 unicast call adapting to steer (running) or followup (idle) |
| `session_query` | Tool | Read-only | List active and idle sessions in current workspace (or cross-workspace) |
| `board_post` | Tool | Pull | Publish announcements or artifacts to the board with zero passive wakeups |
| `board_list` | Tool | Pull | Query board entries with topic/tag filters and optional `titles_only` |
| `board_clear` | Tool | Manage | Dismiss (archive) or purge (delete) board entries |
| `/dsh-call-session` | Slash | Interactive | Web GUI shortcut for board summary or direct unicast dispatch |

### session_call

Dispatches a 1:1 call to a target session. Non-blockingly steers active sessions via `steer`, or starts a new turn via `followup` when idle.

Parameters:
- `target_session_id` (string, required): Full target session ID or unique prefix (>=8 chars). Wildcards (`*`, `all`) are rejected.
- `message` (string, required): Directive or report text (up to 4,000 characters).
- `call_type` (string, optional): Purpose type: `task_dispatch`, `task_report`, or `notice`. Default is `task_dispatch`.
- `context_post_ids` (string[], optional): Referenced board post IDs.

### session_query

Inspects available sessions and runtime statuses in the host environment.

Parameters:
- `query` (string, optional): Case-insensitive match on session ID or title.
- `running_only` (boolean, optional, default `false`): Filter for currently running sessions.
- `cross_workspace` (boolean, optional, default `false`): Search across all workspaces instead of the active project root.
- `limit` (integer, optional, default `50`): Maximum results to return.

Returns a list containing `sessionId`, `title`, `status` (`running` or `idle`), and `cwd`.

### board_post

Publishes shared information to the workspace blackboard. Pure pull mechanism with zero passive wake-up effects.

Parameters:
- `topic` (string, required): Categorical namespace (e.g., `task:audit`, `build:artifact`).
- `content` (string, required): Payload text or Markdown (up to 64KB).
- `tags` (string[], optional): Searchable tags.
- `ttl` (integer, optional, default `3600`): Time-to-live in seconds.

Returns the assigned `postId` and entry metadata.

### board_list

Queries active blackboard records. Scoped to the current workspace by default.

Parameters:
- `topic` (string, optional): Exact topic match.
- `topic_prefix` (string, optional): Prefix match on topic.
- `tag` (string, optional): Tag filter.
- `titles_only` (boolean, optional, default `false`): Returns metadata and title only, saving substantial tokens.
- `cross_workspace` (boolean, optional, default `false`): Search across all workspace roots.
- `limit` (integer, optional, default `20`): Maximum entries to return.

Example:
```json
{
  "name": "board_list",
  "arguments": {
    "topic": "task:audit",
    "titles_only": true
  }
}
```

### board_clear

Removes or archives blackboard entries.

Parameters:
- `id` (string, optional): Target post ID.
- `topic` (string, optional): Target topic.
- `mode` (string, optional, default `dismiss`): `dismiss` for soft archiving, `purge` for permanent deletion.

Example:
```json
{
  "name": "board_clear",
  "arguments": {
    "topic": "task:audit",
    "mode": "dismiss"
  }
}
```

## Commands

In the DSH Web interface, use the `/dsh-call-session` slash command:
- View summary: run `/dsh-call-session` without arguments to list active board posts.
- Send message: run `/dsh-call-session <sessionId> <message>` to dispatch a direct message to that session.

## Config

The plugin works out of the box with built-in defaults (300ms disk debounce, 200 posts capacity).

To customize, add property overrides to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-call-session
  config:
    debounceMs: 500
    maxCapacity: 500
```

Options:
- `enabled` (boolean, default `true`): Enable or disable plugin tools and commands.
- `debounceMs` (number, default `300`): Atomic disk write debounce delay in milliseconds.
- `maxCapacity` (number, default `200`): Maximum entries retained in memory FIFO cache.
- `slashCommand` (boolean, default `true`): Register the `/dsh-call-session` command in Web UI.

## Comparison

Comparison of DSH built-in mechanisms and this plugin:

| Mechanism | Type | Model | When to Use |
| :--- | :--- | :--- | :--- |
| `subagent` | Built-in | Hierarchical delegation (ephemeral child task, exits on completion) | Scoped exploration, code search, one-off script execution. |
| `dsh-call-session` | Plugin | Peer-to-peer collaboration (in-process unicast messaging and shared board) | Directives and status sync between independent top-level sessions, or sharing large outputs. |

### Selection

- Prefer built-in: For isolated scoped tasks, use DSH built-in `subagent` directly without installing plugins.
- Use on demand: When multiple independent top-level sessions need to exchange messages or share bulky context via a blackboard, use `dsh-call-session`.

## Architecture

Key technical decisions are recorded as Architecture Decision Records (ADRs) in [docs/adrs/README.md](./docs/adrs/README.md):

| ADR | Title | Status | Description |
| :--- | :--- | :--- | :--- |
| [ADR-0001](./docs/adrs/0001-separation-of-concerns-board-vs-call.md) | Board vs Unicast separation | Accepted | Pull board and 1:1 unicast, avoiding broadcast storms |
| [ADR-0002](./docs/adrs/0002-builtin-blackboard-store.md) | Built-in board store | Accepted | In-memory cache with local persistence, zero external DB |
| [ADR-0003](./docs/adrs/0003-workspace-scoped-isolation-by-default.md) | Workspace isolation by default | Accepted | Scoped by workspace root with controlled cross-workspace queries |
| [ADR-0004](./docs/adrs/0004-atomic-debounced-persistence-and-healing.md) | Atomic debounced persistence | Accepted | 300ms debounce, atomic file swap, and .bak self-healing |
| [ADR-0005](./docs/adrs/0005-english-metadata-and-two-state-status.md) | Two-state session status | Accepted | Normalizes session states to running and idle |
| [ADR-0006](./docs/adrs/0006-pure-dsh-native-in-process-context-injection.md) | In-process context injection | Accepted | Direct in-memory instance calls with native notice tags |
| [ADR-0007](./docs/adrs/0007-web-slash-command-and-visual-ux.md) | Web slash command | Accepted | Native /dsh-call-session command and minimal UI notifications |
| [ADR-0008](./docs/adrs/0008-zero-pollution-global-profile-mounting.md) | Profile patch mounting | Accepted | Declarative bundle patch with safe lifecycle disposal |
| [ADR-0009](./docs/adrs/0009-restrained-minimalist-docs-and-anti-ai-slop.md) | Restrained docs & anti-slop | Accepted | Zero emoji, radical subtraction, <=4-char headings |

## Testing

Built on the Node.js native test runner:

```bash
# Run unit tests
npm test

# Lint code
npm run lint

# Pre-release verification
npm run verify
```

## License

Licensed under the [MIT License](./LICENSE).
