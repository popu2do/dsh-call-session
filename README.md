<p align="center">
  <img src="./assets/hero.png" width="100%" alt="dsh-call-session hero" />
</p>

<h1 align="center">dsh-call-session</h1>

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
  English | <a href="README_ZH.md">简体中文</a>
</p>

---

## Overview

DeepSeek Harness sessions are isolated by default, and child tasks exit upon completion.

`dsh-call-session` adds in-process cross-session communication, peer session creation, and shared blackboard capabilities:
- Inter-session unicast: send directives or hand off tasks between independent long-running sessions.
- Shared blackboard: publish bulky artifacts to a shared board for on-demand retrieval, avoiding context bloat.
- Visual canvas: observe session states, blackboard items, and call trajectories in the DSH Web UI.

---

## Install

```bash
# Add to target profile web
dsh plugin --profile web add dsh-call-session

# List installed plugins
dsh plugin --profile web list

# Remove plugin
dsh plugin --profile web remove dsh-call-session
```

> Note: The `--profile` option must follow the `plugin` subcommand, e.g. `dsh plugin --profile web ...`.

---

## Scenarios

Instruct the agent using plain natural language in the chat; the agent invokes the tools automatically:

### Task Handoff

User prompt:
> Hand off this task summary to the "audit-session" session.

The agent calls `session_call` to dispatch a unicast message. If the target session is running, it steers execution; if idle, it wakes a new turn.

### Post Results

User prompt:
> Publish the review conclusions to the board and notify relevant sessions to pick up tasks.

The agent calls `board_post` to store the detailed report on the blackboard and obtain a `postId`. Other sessions retrieve the content on demand via `board_list`, preventing context window explosion.

### Create Session

User prompt:
> Create a new session and hand off tasks.

The agent calls `session_create` to spawn a long-running peer session in the current workspace, automatically inheriting model specifications and presets.

---

## Canvas

The DSH Web session view exposes a `Canvas` tab to observe multi-agent collaboration across workspaces:

<p align="center">
  <img src="./assets/canvas-demo.png" width="100%" alt="dsh-call-session canvas" />
</p>

- Topology: workspace columns, running/idle session nodes, blackboard items with TTL countdowns, and directional call traces.
- Interaction: hovering highlights the 1-hop connected subgraph; double-clicking opens a read-only inspector drawer.
- Read-only boundary: the canvas offers no control inputs; all state changes originate from the agents themselves.

---

## Tools

| Tool | Type | Mode | Common Use Case |
| :--- | :--- | :--- | :--- |
| `session_call` | Tool | Push | 1:1 unicast call for task dispatch, progress reporting, and handoffs |
| `session_create` | Tool | Native | Create long-running peer sessions for parallel multi-role collaboration |
| `session_query` | Tool | Read-only | List sessions and check active/idle statuses in or across workspaces |
| `board_post` | Tool | Pull | Publish blackboard entries for large artifacts and shared milestones |
| `board_list` | Tool | Pull | Query blackboard records by ID, topic, or digest mode |
| `board_clear` | Tool | Manage | Dismiss or purge completed and expired blackboard entries |

---

## Comparison

| Mechanism | Type | Model | When to Use |
| :--- | :--- | :--- | :--- |
| `subagent` | Built-in | Hierarchical delegation, ephemeral child task, exits on completion | Scoped exploration, code search, one-off script execution. |
| `dsh-call-session` | Plugin | Peer-to-peer collaboration, in-process unicast messaging and shared board | Directives and status sync between independent top-level sessions, or sharing large outputs. |

Selection guidelines:
- Prefer built-in: for isolated, scoped tasks, use DSH built-in `subagent` directly.
- Use on demand: when multiple independent top-level sessions need to coordinate or share large context via a blackboard, use `dsh-call-session`.

---

## Config

The plugin runs with built-in defaults out of the box.

To customize, add property overrides to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-call-session
  config:
    debounceMs: 500
    maxCapacity: 500
```

Options:
- `enabled`: boolean, default `true`. Enable or disable plugin tools.
- `debounceMs`: number, default `300`. Atomic disk write debounce delay in milliseconds.
- `maxCapacity`: number, default `200`. Maximum board entries.
- `telemetryCapacity`: number, default `200`. Maximum call traces retained in canvas data buffer.

---

## Architecture

Technical decisions are recorded as Architecture Decision Records (ADRs):

- Decision catalog: see [docs/adrs/README.md](./docs/adrs/README.md).
- Architecture topology: see [docs/architecture/](./docs/architecture/).

---

## Compatibility

| Environment | Supported | Verified |
| :--- | :--- | :--- |
| DeepSeek Harness | `>=0.1.1-rc.1` | `0.1.2-rc.1`, `0.1.5-rc.1`, `0.1.5-rc.2` |
| Cordis | `^4.0.2` | `4.0.2+` |
| Node.js | `>=20.0.0` | `20.x`, `22.x` |

---

## License

This project is licensed under the [MIT License](./LICENSE).