# Choose the session and conversation continuity model

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

How should users organize diagrams, understand their saved state and history, and resume or reset Codex conversations without ambiguity?

## Evidence to use

- Sessions are durable directories containing a diagram, metadata, agent instructions, snapshots, and a Codex thread id.
- Chat messages are browser-memory only and disappear on reload or session switch even though the Codex thread persists.
- The current selector accumulates similarly named diagrams and has no archive, delete, search, or recent-work model.
- Development startup can create duplicate initial sessions under React Strict Mode, reinforcing the need for an explicit idempotent session lifecycle.

## Answer

### Decision

MDVE v1 uses a **diagram-first library with durable, diagram-scoped
conversations**. The user organizes **Diagrams**, not “sessions.” Each Diagram
has one Diagram workspace containing the canonical source and recovery history,
and may have zero or more Conversations. Each Conversation has its own durable
transcript and provider-thread identity but always operates on the Diagram's
current `diagram.mmd`; it never owns a forked copy of the diagram.

The product keeps three timelines separate:

| Timeline | Owns | User-visible state |
| --- | --- | --- |
| Diagram durability | source revisions, recovery drafts, recovery points | `Saving`, `Saved · revision N`, `Save failed`, `Conflict`, `Recovery available`, `Saved · history unavailable` |
| Conversation continuity | prompts, agent responses, turn trace/outcome, provider thread | `No conversation`, `Ready`, `Running`, `Stopped`, `Failed`, `Interrupted`, `Cannot resume` |
| Library lifecycle | recency, archive, restore, Trash | `Recent`, `All diagrams`, `Archived`, `Trash` |

Restoring a Diagram never rewinds a Conversation. Resuming a Conversation never
changes which Diagram revision is canonical. The UI shows the revision last seen
by that Conversation and marks the boundary when the Diagram has since changed.

#### Diagram library and startup

V1 provides a flat local library with **Recent**, **All diagrams**, and
**Archived** scopes plus title-and-source search. Folders, tags, cloud projects,
and cross-diagram conversations are deferred. Duplicate titles remain legal,
but every row also shows meaningful activity time, diagram type or source
summary, and any save/recovery warning so identical names are distinguishable.

“Recent” sorts by `lastActivityAt`: a durable source change or Conversation turn.
Opening, renaming, archiving, restoring visibility, changing a model preference,
or writing provider metadata does not make a Diagram look recently worked on.
Those actions have their own metadata timestamps.

Startup is idempotent:

1. Reopen the last selected non-archived Diagram when it still exists.
2. Otherwise open the most recently active non-archived Diagram.
3. If none exists, create exactly one starter Diagram through a server-side
   create-or-return operation.
4. A deliberate **New diagram** action creates exactly one Diagram and selects it.

React remounts, repeated requests, reconnects, and launcher restarts may not
create additional blank Diagrams. Existing provably untouched starter duplicates
may be offered as a reversible bulk-archive action; MDVE does not guess that a
renamed, edited, imported, or Conversation-owning Diagram is disposable.

#### Archive, Trash, and authorized lifecycle actions

Archive is the default cleanup action. Archiving first flushes pending edits and
creates the required recovery point, then removes the Diagram from active scopes
without deleting its source, history, Conversations, or provider continuity. A
running agent turn must complete or stop before archive. **Archived** is always a
reachable scope, and Restore returns the same Diagram identity without rewriting
its content or recency.

Deleting, if exposed in v1, moves the Diagram to 30-day recoverable Trash under
the durability contract. Permanent deletion exists only inside Trash, requires
an explicit destructive action, and is never implied by Archive.

The UI and authorized automation use the same first-party lifecycle operations
for New, Archive, Restore, and Trash. An agent may create or archive Diagrams when
the user has put that action in scope, as in this Wayfinder work; MDVE records the
action origin and keeps Archive reversible. Agents may not turn that authority
into permanent deletion or hidden filesystem moves.

#### Conversation continuity

A Conversation persists server-side, not in browser memory. It records its
messages, provider and provider-thread identity, per-turn model and reasoning
effort, timestamps, starting and ending Diagram revisions, structured progress,
final response or error, and durable turn outcome. The provider thread id is an
internal resumability pointer; it is not the transcript and cannot by itself make
a Conversation appear recoverable.

The UI uses explicit actions:

- **Continue conversation** sends the next turn through the same Conversation
  and provider thread.
- **New conversation** creates a fresh transcript and provider thread from the
  current acknowledged Diagram revision; it does not erase the old Conversation.
- **Archive conversation** hides an older Conversation without deleting its
  transcript or thread identity.
- **Restore and continue** returns an archived Conversation to the visible list
  and resumes it against the current Diagram after showing any revision gap.

“Reset conversation” is not a v1 action because it hides whether history was
deleted, a provider thread was replaced, or a fresh context was created.

On reload or Diagram switch, MDVE restores the last selected Conversation and its
transcript. If the provider thread no longer exists or cannot resume, the old
transcript remains readable with **Cannot resume** and a **New conversation from
current Diagram** action; MDVE never silently substitutes a fresh thread under the
old Conversation identity.

The Diagram's agent write lease applies across all its Conversations, so only one
turn may write a Diagram at a time even across tabs. Different Diagrams may run
in parallel. A persisted `running` turn recovered after restart becomes
`interrupted` as established by the durability contract.

### Options considered

| Option | Data integrity | Continuity clarity | Architecture fit | Organization | Decision |
| --- | --- | --- | --- | --- | --- |
| One Diagram plus one mutable Codex thread; browser-only transcript | Low | Low | High | Low | Reject |
| Diagram-first library; durable multi-Conversation history | High | High | High | High | Choose |
| Conversation-first workspaces where every new chat forks the Diagram | Medium-low | Medium | Low | Medium | Reject |

The single-thread model is superficially small but makes “reset” destructive or
ambiguous and leaves a provider thread resumable after its visible evidence has
disappeared. The conversation-first model preserves chat branches but creates
multiple competing `diagram.mmd` files, undermining the chosen source-of-truth
and recovery contracts. The chosen model keeps one source timeline while
preserving every conversational context that acted on it.

### Evidence and trade-offs

- An isolated development start created two indistinguishable starter Diagrams
  under React Strict Mode; one deliberate New action created a third. Startup
  creation is currently a browser race rather than an idempotent domain action.
- A live isolated Codex turn completed successfully and wrote a provider thread
  id plus a pre-turn snapshot. Switching away and back erased the visible
  transcript while the thread remained resumable on disk.
- Aggregate live metadata contained nine active Diagram directories, four with
  the default title and two with provider threads, but no archive state or
  recovery scope. No diagram contents or thread identifiers were inspected.
- The current `updateMeta` changes `updatedAt` for renames, saves, and provider
  thread updates alike, so the existing sort order cannot mean “recent work.”
- The server accepts a `newThread` flag, but the current UI exposes neither New
  Conversation nor durable prior Conversations. The selector also has no search,
  Archive, Trash, or unique context for duplicate titles.

This decision adds a durable Conversation store, lifecycle metadata, library
scopes, migration for existing Diagram directories, and explicit revision-gap
states. It deliberately avoids v1 folders and multi-diagram chat. That is the
smallest model that makes reload, resume, reset, archive, restore, and recovery
truthful instead of relying on a hidden provider id.

Confidence: **high (0.95)**. The live behavior reproduces both observed failure
modes, and the selected boundaries align with the file-backed durability
contract. The remaining provider-specific question is now isolated in **Choose
the v1 agent-provider boundary**.

## Comments
