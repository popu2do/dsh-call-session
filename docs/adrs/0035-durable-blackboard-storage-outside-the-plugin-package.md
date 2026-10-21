# ADR-0035: Durable Blackboard Storage Outside the Plugin Package

- **Status**: Accepted
- **Date**: 2026-10-19
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Release and Ecosystem Maintainers, Package Consumers
- **Informed**: All DSH Users, Downstream Profile Maintainers

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points

The board store defaulted to `board.json` inside the plugin package root:

```javascript
const DEFAULT_STORAGE_PATH = path.resolve(PLUGIN_ROOT, 'board.json');
```

ADR-0008 requires global mounting through the DSH profile. A profile installs the plugin into `node_modules`, and any upgrade, reinstall, or version switch replaces that package directory outright. The blackboard file, which holds every post, tag and coordination record, therefore lived in the one location that is routinely destroyed. Nothing about this was occasional: it followed from the installation model.

The defect surfaced as a hygiene assertion in `tests/board-adversarial-hygiene.test.mjs`, which failed whenever a real board file existed in the repository root. That assertion described the symptom. It could be satisfied by pointing the default at the working directory, which would have preserved the data-loss defect while turning the test green.

ADR-0008 section 4.3 recorded the location as `storageDir: __dirname` without any stated reason. The gap was not a missing decision but a missing argument: the choice existed and nothing justified it.

### 1.2 Architectural Forces & Constraints

- **Data Outlives Installation**: Collaboration records must survive any number of plugin upgrades.
- **Zero Configuration by Default**: ADR-0008 forbids requiring per-project setup, so the default must be usable without a config entry.
- **Single Shared Board**: ADR-0003 rejects per-workspace board files, because the store is one file whose posts each carry a workspace field and are filtered on read. Splitting the file per workspace would fragment the canvas view that ADR-0013 keeps globally transparent.
- **Harness Home Precedence**: The host resolves user data under one root, honoring an explicit path, then `$DSH_HOME`, then `~/.dsh`, and treating a blank override as unset.

---

## 2. Decision Drivers

- **Driver 1 (Durability)**: A plugin upgrade must never be able to remove user data.
- **Driver 2 (Host Alignment)**: Default paths should follow the harness home convention rather than inventing a second one.
- **Driver 3 (No Silent Loss)**: Changing a default must not make existing records disappear without notice.
- **Driver 4 (Reversibility)**: A user who rolls back must still find their records.

---

## 3. Considered Options

### Option 1: Keep the Plugin Directory and Require Explicit Configuration

- **Pros**: No migration; no new default to reason about.
- **Cons**: Violates the zero-configuration constraint of ADR-0008. Every consumer who does not configure storage keeps losing data, and the failure is silent.

### Option 2: Store Beside the Workspace

- **Pros**: Records travel with the project; workspace isolation becomes physical.
- **Cons**: ADR-0003 already rejected per-project board files as unable to perform cross-repository orchestration. It also contradicts ADR-0013, under which the human canvas shows all workspaces at once.

### Option 3: Store Under the Harness Home (Chosen)

- **Pros**: Survives upgrades; matches the host's own resolution order; one board shared across workspaces, preserving both ADR-0003 read filtering and ADR-0013 canvas transparency.
- **Cons**: One migration is required for existing installs.

---

## 4. Decision Outcome

**Chosen Option**: Option 3.

### 4.1 Default Location

The default is `<harness home>/dsh-call-session/board.json`, resolved as an explicit configured path, then `$DSH_HOME`, then `~/.dsh`. A blank `$DSH_HOME` counts as unset so it can never resolve the board into the working directory. `config.storagePath` still overrides everything.

The resolver is implemented inside the plugin rather than imported from `@deepseek-ai/dsh-home-paths`. Two measured reasons, neither of them preference:

1. **A plain dependency installs a different rule than the host runs.** The package is published only as prereleases, and its `latest` tag is stuck at `0.0.1-rc.3` while the harness ships `0.2.0-rc.2`. Measured: `npm install @deepseek-ai/dsh-home-paths` resolves to `0.0.1-rc.3`. A plugin that declares it therefore computes user paths by whichever prerelease its range happens to pick, not by the rule of the harness that loaded it.
2. **It drags a second copy of the framework graph.** That same install pulls `cordis`, `cosmokit`, `dsh-invariants` and `schemastery` — six packages for one path convention. The harness ships its own copies, and a plugin installed into a profile would shadow them.

It is not that the package cannot be reached: the first-party packages that import it, including `dsh-skill-filesystem`, all live inside the harness distribution tree and resolve it there. A third-party plugin mounted into a profile would have to declare it as a dependency, which is exactly the case the two reasons above rule out.

A dynamic import with a local fallback was considered and rejected: the resolved path would then depend on what the surrounding profile happens to hoist, so the same plugin would place user data in different directories on different machines.

The rule itself is small and stable: one environment variable, one directory name, one tilde expansion. Duplicating it costs less than any of the alternatives, and the tests pin the behaviour that matters.

### 4.2 One-Time Migration

On startup, if the configured location has no file and either the legacy file or its backup still exists, the store copies what survived to the new location and logs one line. It never deletes the legacy files: deletion is not required for correctness, and keeping them makes a rollback safe.

Migration runs before the first read, because `loadSync` treats a missing file with a missing backup as an empty board and initializes silently.

A failed copy is a fault, not a routine condition: the legacy file exists and could not be carried over, so the failure is logged at error level rather than as a warning. The legacy file is left untouched, which keeps a manual recovery possible for as long as the old directory survives.

### 4.3 Which Installs Migration Can Rescue

The migration is limited by when the package manager acts, and the limit is worth stating plainly because it bounds the benefit.

**Link installs and source checkouts are rescued.** When a profile links to a checkout, the plugin root is the checkout itself. An upgrade changes code, never that directory, so the legacy file is still there on first start and the copy succeeds.

**npm installs are not rescued.** Measured: installing a new version of a package replaces its directory outright, so a file written next to `package.json` by the outgoing version is gone before any code of the incoming version runs. No in-process step can recover a file the package manager deleted first. The migration cannot be the whole remedy for these users, and pretending otherwise would be the same class of error as the proxy test being replaced here.

The remedy for npm installs is operational and belongs in the release note for the version that carries this change: move `board.json` out of the installed package directory before upgrading. Records lost this way are bounded by the board's TTL and capacity limit rather than being permanent archives, which lowers the cost but does not remove the step.

### 4.4 Test Contract

Two tests split the obligations. The dedicated storage test asserts the exact resolved default path, the environment precedence, and the migration behaviour, all under a temporary harness home so nothing touches real user data.

The hygiene test replaces the old proxy, which only checked for the absence of a file in the repository root and which any wrong default could satisfy. It now asserts that the plugin package directory stays free of board files, which catches the store writing beside its own code at runtime, a failure the exact-path assertion would not detect.

Migration runs only when the store uses the default location. A caller that configures its own storage path owns that file, so a legacy board is never copied into it.

---

## 5. Consequences

### 5.1 Positive

- Upgrading the plugin can no longer destroy collaboration records.
- The default path matches the host convention, so users find the file where they expect user data to live.
- Rolling back to an older build still finds the legacy file untouched.

### 5.2 Negative

- A first run after upgrade copies one file. The copy is bounded by the board's own capacity limit and happens once per install.
- Two locations can hold a board at once until the user removes the legacy file. The new location always wins on read, so this never produces divergent state.
- Users installed from npm must move their board file once, by hand, on the upgrade that carries this change. Earlier upgrades already destroyed such files, so this is the last one that can cost anything.

### 5.3 Neutral & Operational Shifts

- Release notes must call out the move and the one-off manual step, since the file path is user-visible and the loss window closes at this version.
- The legacy path remains a named constant rather than a magic string, so a future removal is a single deletion.
