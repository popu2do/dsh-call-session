# ADR-0004: Atomic Debounced Persistence Engine with Windows Lock Retries and Self-Healing

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Systems Performance Ops, Windows Platform Specialists
- **Informed**: All DSH Developers, Core Framework Maintainers

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points

The public board store (`board.json`) is the single source of truth for persistent cross-session state, task dependencies, and announcements. In multi-agent scenarios, dozens of subagents concurrently issue `board_post` and `board_clear` calls.

Under naive filesystem persistence strategies (e.g. synchronous `fs.writeFileSync(path, data)` on every call), three severe production failure modes emerged:
1. **Disk I/O Thrashing & Event Loop Stalls**: Rapid bursts of 50+ posts per second blocked the Node.js event loop and caused heavy disk thrashing.
2. **Windows `EBUSY` / `EPERM` Lock Contention**: On Windows filesystems, background antivirus scanners (e.g. Windows Defender), IDE indexing services (VSCode), or parallel process handles frequently place momentary read locks on `board.json`. Direct writes or naive renames routinely crashed with `EBUSY: resource busy or locked` or `EPERM: operation not permitted`.
3. **Truncated Files & Corrupt JSON ("Bad Blocks")**: If the host process was abruptly terminated (e.g. user killing terminal, system restart, crash) in the middle of writing `board.json`, the file was left zeroed or partially written. Upon next launch, `JSON.parse` threw a fatal syntax error, permanently destroying the team's entire historical state.

### 1.2 Architectural Forces & Constraints

- **Nanosecond Read/Write Latency**: Agents must never experience blocking disk I/O when reading or posting board items.
- **Zero-Data-Loss Reliability**: Process crashes or unexpected kills must never corrupt the durable database.
- **Cross-Platform Resiliency**: Must operate reliably across POSIX and Windows NTFS/ReFS filesystems without requiring external native C++ bindings.

---

## 2. Decision Drivers

- **Driver 1 (I/O Batching & Debouncing)**: Coalesce rapid mutation bursts into a single scheduled disk write.
- **Driver 2 (All-or-Nothing Atomicity)**: Guarantee that readers never observe partial or malformed JSON payloads.
- **Driver 3 (Windows Lock Resilience)**: Tolerate temporary file locks by implementing non-blocking exponential backoff retries.
- **Driver 4 (Automated Disaster Recovery)**: Provide an out-of-band backup mirror (`board.json.bak`) capable of transparent self-healing when bad blocks are detected.

---

## 3. Considered Options

### Option 1: Synchronous Direct Overwrite (`fs.writeFileSync`)
- **Description**: Write JSON directly to `board.json` on every mutating call.
- **Pros**: Trivial to implement.
- **Cons**: Severe performance degradation; catastrophic vulnerability to power loss/crashes; frequent Windows `EBUSY` crashes.

### Option 2: Embedded Database (SQLite / LevelDB)
- **Description**: Introduce an embedded ACID database engine like `better-sqlite3`.
- **Pros**: Built-in ACID transactions and crash recovery.
- **Cons**: Requires native C++ compilation (`node-gyp`), breaking pure-JS zero-dependency portability in DSH plugins; binary database format prevents easy human inspection or git diffing.

### Option 3 (Chosen): Memory-Primary Store + Debounced Atomic Rename with `.bak` Self-Healing
- **Description**:
  1. Primary state resides in a fast in-memory JavaScript `Map`, guaranteeing sub-microsecond responses.
  2. Mutating operations trigger a trailing 300ms debounce timer.
  3. Flushes write to a unique temporary file (`board.json.tmp.<pid>.<time>.<rand>`) and perform an atomic rename.
  4. Renames on Windows retry up to 5 times with exponential backoff (20ms -> 320ms).
  5. Successful flushes duplicate the snapshot to `board.json.bak`. Corrupt primary files on startup automatically heal from `.bak`.
- **Pros**: Pure Node.js standard library (zero native dependencies); immune to corrupt half-writes; robust on Windows; lightning-fast in-memory operations.
- **Cons**: Up to 300ms of state could theoretically be unwritten if the process is killed via `SIGKILL -9`. (Acceptable for an interactive session coordinator; mitigated by explicit `close()` flush on graceful exit).

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Memory-Primary Store with Debounced Atomic Flush and Self-Healing.

### 4.1 Core Architectural Principles & Invariants

1. **In-Memory Primary Source of Truth**:
   - `this.posts = new Map()` satisfies all reads immediately.
   - `board_post` and `board_clear` update the map synchronously in memory.
2. **Trailing Debounced Flush**:
   - `scheduleFlush()` coalesces multiple operations within `debounceMs` (default: 300ms).
   - If another write occurs while a flush is in-flight, `needsFlush = true` queues an immediate trailing flush.
3. **Atomic File Replacement**:
   ```javascript
   // lib/board-store.mjs Line 272-331
   const tmpPath = `${this.storagePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
   await fs.writeFile(tmpPath, serializedData, 'utf8');
   await this.atomicRenameWithRetry(tmpPath, this.storagePath);
   ```
4. **Exponential Backoff on Windows (`atomicRenameWithRetry`)**:
   - Retries up to 5 times on `EBUSY`, `EPERM`, or `EACCES`.
   - Backoff delays: 20ms -> 40ms -> 80ms -> 160ms -> 320ms.
5. **Mirror Backup & Transparent Self-Healing**:
   - Each successful flush copies the data to `board.json.bak`.
   - On startup (`loadSync`), if `JSON.parse` of `board.json` fails:
     1. Log warning: `[BoardStore] 主文件损坏，尝试从备份恢复...`
     2. Attempt to parse `board.json.bak`.
     3. Hydrate state from backup and schedule an immediate flush to repair `board.json`.
     4. If both are missing or corrupt, initialize an empty board safely without crashing.

### 4.2 System Architecture & Topology

```
[Agent Calls: board_post / clear]
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    BoardStore (In-Memory)                    │
│                                                             │
│   • Map<id, Post> (Instant Read/Write)                      │
│   • Capacity FIFO Eviction (maxPosts = 200)                 │
│   • TTL Lazy Eviction                                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼ (300ms Debounce Timer)
┌─────────────────────────────────────────────────────────────┐
│                    Atomic Flush Engine                      │
│                                                             │
│   1. Serialize Map to JSON string in memory                 │
│   2. Write to board.json.tmp.<pid>.<ts>.<rand>              │
│   3. Atomic rename tmp => board.json                        │
│      └──> [Catch EBUSY/EPERM] ---> 5x Backoff Retries       │
│   4. Write mirror copy => board.json.bak                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│       board.json (SSOT)      │              │      board.json.bak (Mirror) │
└──────────────┬───────────────┘              └──────────────┬───────────────┘
               │                                             │
               └--------> [If corrupt on startup] <----------┘
                          Transparent Self-Healing
```

### 4.3 Interface & Implementation Details

#### Core Methods (`lib/board-store.mjs`)
- `loadSync()`: Synchronous bootloader with bad-block detection and backup failover (`Line 43-58`).
- `recoverFromBackup()`: Restores state from `backupPath` and schedules auto-repair flush (`Line 60-74`).
- `scheduleFlush()`: Manages 300ms timer and trailing execution flags (`Line 262-270`).
- `flushAtomic()`: Atomic file writing, exponential retry loop, and backup syncing (`Line 272-331`).
- `close()`: Flushes pending memory writes and unlinks timers during DSH shutdown (`Line 333-342`).

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Extreme Speed**: Reads and writes take less than 0.1ms since they hit Node.js heap memory directly.
- **Resilience Against Crashes**: No half-written or zero-length JSON files can ever replace `board.json`.
- **Zero Windows Lock Failures**: Exponential backoff absorbs transient file locking from antivirus or IDE tools.
- **Auto-Healing**: A corrupted file automatically repairs itself from `.bak` on restart without manual intervention.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **300ms Durability Window**: If the system undergoes an immediate kernel panic or `kill -9`, the last 300ms of updates may be lost.
  - *Mitigation*: Graceful shutdown is wired to `ctx.on('dispose')`, ensuring clean store flushes on exit.

### 5.3 Neutral & Operational Shifts
- Two files exist on disk (`board.json` and `board.json.bak`). Both are human-readable, formatted JSON files.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **High-Concurrency Debounce Test**: Fire 100 consecutive `board_post` calls in a microtask loop; verify via filesystem spy that `fs.writeFile` is called at most 1–2 times.
- **Bad-Block Fault Injection Test**: Intentionally overwrite `board.json` with malformed text (`{ broken json ... `); instantiate `new BoardStore()`; assert that state successfully hydrates from `board.json.bak` and repairs the primary file.
- **Windows Lock Simulation**: Simulate `EBUSY` error during `fs.rename`; verify that retry mechanism backs off and succeeds on subsequent attempts.

### 6.2 Code Review & Maintenance Checklist
- [x] Disk operations must never be executed synchronously on the request hot path.
- [x] Temporary filenames must include process PID and random entropy to prevent collision.
- [x] `close()` must await any active flush to ensure clean persistence before process exit.

---

## 7. Status History & Related Artifacts

- **2026-09-03**: Proposed by Engineering Team.
- **2026-09-03**: Accepted; integrated into `lib/board-store.mjs`.
- **Related ADRs**:
  - Related to: [ADR-0001](./0001-separation-of-concerns-board-vs-call.md) (Board vs Call Separation)
  - Related to: [ADR-0002](./0002-builtin-blackboard-store.md) (Built-in Blackboard State Store)
- **Implementation Artifacts**:
  - Primary source: `lib/board-store.mjs` (Line 43-74, 262-342)
