# Choose the v1 durability and recovery contract

Type: grilling
Status: resolved
Blocked by:

## Question

What explicit save, recovery, history, and agent-change guarantees must MDVE make before users can trust it with real diagrams?

## Evidence to use

- Diagram files are the source of truth and agent turns create filesystem snapshots.
- In-editor undo disappears when the tab closes.
- The immediate save-loss blocker is now repaired with per-session serialized scheduling, visible save state, retry, and atomic file replacement.
- The remaining contract must settle close-tab flushing, user-visible history and restore, retention, and recovery from interrupted agent turns.

## Answer

### Decision

MDVE v1 adopts a **revisioned, file-backed durability contract**. `diagram.mmd`
remains the only source of truth; browser drafts and server-side recovery points
are explicitly recovery material, never a competing diagram model.

The user-facing promise is:

> Once MDVE says **Saved**, that exact diagram survives a tab, browser, or MDVE
> process restart on intact local storage. Before MDVE says **Saved**, it never
> silently discards the latest edit: it either finishes the save, retains a
> recoverable draft, or tells the user recovery is unavailable.

#### Acknowledged saves and close behavior

Every accepted change carries the durable revision it was based on. MDVE writes
the new source through a per-session serialized queue, atomically replaces
`diagram.mmd`, flushes the file and parent-directory metadata to disk, advances a
monotonic revision, and only then reports **Saved**. A failed write remains
visible and retryable; the UI must not show a stale success state.

The browser journals the latest unacknowledged source synchronously per session.
That **recovery draft** survives reload or browser-process failure and is cleared
only when the matching durable revision is acknowledged. If journaling itself
fails, MDVE exposes that degraded state immediately.

Creating or switching sessions, importing a replacement, restoring history, and
starting an agent turn must first flush pending edits. Reload or tab close starts
an immediate flush and warns before leaving while neither a durable save nor a
confirmed recovery draft covers the latest edit. There is no promise that an
arbitrary browser can complete an asynchronous request during shutdown; the
recovery draft closes that gap.

#### Conflict rule

Writes are conditional on their base revision. A stale tab, delayed request,
external file change, or agent change may never win through last-write-wins.
MDVE preserves the stale source as a recovery draft and presents a conflict with
both versions available. It does not silently merge Mermaid text.

#### Durable recovery points

MDVE exposes a History view backed by immutable, checksummed recovery points.
Each point records its durable revision, timestamp, origin (`manual`, `import`,
`agent`, or `restore`), and agent-turn outcome when relevant. Identical source is
deduplicated.

Recovery points are created:

- after 30 seconds of editing inactivity and at least every 5 minutes during
  sustained manual editing;
- before an import, restore, or other full-source replacement;
- before every agent turn, after all user edits are durably saved;
- after an agent turn completes, stops, fails, or is recovered as interrupted;
- before a clean session switch when the durable head differs from the newest
  recovery point.

Ordinary in-tab undo remains a fast convenience, not a durability guarantee.

#### Restore behavior

History lets the user inspect the source, origin, time, and agent outcome before
restoring. Restore first checkpoints the current durable head, then writes the
selected source as a new durable revision. It never rewinds or deletes history,
so every restore is itself recoverable.

A diagram restore does not pretend to rewind the Codex conversation. The UI must
state that boundary; the separate session-and-conversation decision determines
how resumed or reset conversations are organized.

#### Agent-change recovery

An agent turn may start only from an acknowledged durable revision with a
successful pre-turn recovery point. The turn holds an exclusive **agent write
lease** for that diagram: source and visual mutation become read-only while Stop
remains available. This avoids an editor save racing a filesystem-writing agent.

The turn lifecycle is persisted as `running`, `completed`, `stopped`, `failed`,
or `interrupted`, not inferred from an in-memory connection. On restart, a
persisted `running` turn becomes `interrupted`; MDVE captures the current partial
source, shows what happened, and offers three explicit actions: keep the partial
result, inspect it against the pre-turn point, or restore the pre-turn point. It
never silently rolls an interrupted turn backward or calls a partial result
complete.

#### Retention and degradation

Per session, MDVE retains every recovery point from the last 30 days and at
least the newest 100 points even when they are older. History cleanup follows
that published rule and never removes the current `diagram.mmd`. A future session
deletion flow must use a 30-day recoverable trash unless the user explicitly
chooses permanent deletion.

If a routine history write fails, the current diagram may still save, but MDVE
must show **Saved — history unavailable** until recovery-point creation works
again. Agent turns, imports, and restores are blocked when their required
pre-change recovery point cannot be written.

This is local recovery, not backup. V1 does not promise survival after disk
failure, manual deletion of the MDVE data directory, or cross-device loss; users
retain normal access to `diagram.mmd` for version control and external backup.

### Options considered

| Option | Correctness and recovery | Architecture fit | User clarity | Operability | Decision |
| --- | --- | --- | --- | --- | --- |
| Debounced autosave, in-tab undo, and hidden pre-agent snapshots | Low | High | Low | High | Reject |
| Make each session a Git repository and expose commits as history | High | Medium | Medium-low | Medium | Reject for v1 |
| Canonical file plus conditional revisions, recovery drafts, and a local recovery ledger | High | High | High | Medium-high | Choose |

Autosave alone cannot recover after a closed tab, exposes no restore path, and
does not prevent stale tabs or an agent from overwriting newer work. Git provides
strong storage mechanics but makes a private implementation repository part of
the product model, adds commit/lock failure modes, and still needs an MDVE-native
view for agent outcomes and interrupted turns. The chosen contract keeps the
existing local-file advantage while adding only the state needed to make its
guarantees testable and understandable.

### Evidence and trade-offs

- The current serialized persistence work already proves independent-session
  saves, ordered latest-write behavior, visible failure, retry, and atomic file
  replacement. It is the correct floor, but it has no revision conflict check,
  shutdown journal, or durable history contract.
- `snapshotDiagram` writes a pre-agent file, but snapshots have no manifest,
  retention policy, API, or restore UI. A user cannot currently discover or act
  on them from MDVE.
- The server tracks running agents only in memory and aborts a turn when the
  stream closes. It cannot currently distinguish stop, failure, browser
  disconnect, server crash, or a safely completed turn after restart.
- The session directory already owns the source, metadata, agent instructions,
  thread identity, and recovery material, so the recovery ledger belongs there
  without introducing accounts or hosted state.

This choice adds revision metadata, browser draft handling, history storage, and
several explicit degraded states. It also makes the diagram read-only during an
agent turn. Those costs are justified because MDVE's chosen winning job depends
on moving among editor, rendered graph, and filesystem-writing agent without
either actor silently erasing the other's work.

Confidence: **high (0.91)**. The contract follows the chosen local-first product
direction and closes every currently observed silent-loss path. The main
remaining uncertainty is the exact session/history presentation, which is
already isolated in **Choose the session and conversation continuity model**.

## Comments

- 2026-07-28: shipped the immediate quality floor without closing this decision; `npm test` locks down independent-Diagram saves, latest-write ordering, retry after failure, and flush-before-switch behavior.
