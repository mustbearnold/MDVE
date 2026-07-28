# MDVE Context

Canonical product vocabulary for MDVE. Decision rationale lives in the linked Wayfinder ticket rather than in this glossary.

## Product vocabulary

- **Primary user** — An individual Linux software engineer or technical founder who already uses Mermaid or Markdown and Codex.
- **Technical flowchart** — A Mermaid `flowchart` or `graph` used to reason about software architecture, system behavior, incident paths, or implementation work.
- **Winning job** — Turning fuzzy technical reasoning or an existing `.mmd` file into a correct, durable, version-control-ready technical flowchart without copying between separate agent, editor, preview, and whiteboard tools.
- **Diagram workspace** — The durable local container that owns one Diagram's source, metadata, agent instructions, recovery material, and Conversations. User-facing copy calls it a Diagram; avoid the overloaded term “session.”
- **Diagram library** — The active and archived Diagram workspaces a user can search and revisit. Library lifecycle does not change a Diagram's source or recovery history.
- **Conversation** — A durable sequence of agent turns attached to one Diagram workspace and one provider-thread identity. It always acts on the Diagram's current source and never owns a forked source.
- **Conversation turn** — One user request and its agent progress, response, outcome, and starting and ending durable revisions within a Conversation.
- **Archive** — A reversible visibility state for a Diagram or Conversation that retains source, history, transcript, and provider continuity. Archive is not Trash or permanent deletion.
- **Source of truth** — `diagram.mmd`; rendered and structured views derive from this file and must not maintain a competing diagram model.
- **Durable revision** — A monotonically numbered `diagram.mmd` version that MDVE has atomically written, flushed to local disk, and acknowledged as **Saved**.
- **Recovery draft** — The browser-journaled latest source that has not yet become a durable revision; it exists only to prevent unacknowledged work from being silently lost.
- **Recovery point** — An immutable, checksummed, user-visible snapshot of a durable revision, with its time and origin, that can be restored as a new revision.
- **Agent write lease** — The exclusive interval in which an agent may change a diagram; direct source and visual mutation pause until the turn completes, stops, fails, or is recovered as interrupted.
- **Structured edit** — A visual edit that rewrites only the modeled Mermaid statements it changes while preserving opaque source verbatim.
- **Source-only Diagram** — A Diagram that renders and remains editable through source or Codex but does not qualify for structured visual mutation. In v1, every Mermaid grammar except `flowchart` and `graph` is source-only.
- **Agent transformation** — A Codex turn that reads and edits `diagram.mmd` inside its Diagram workspace and reports progress to the workspace.
- **Local web application** — MDVE's v1 delivery form: an `mdve` CLI starts one loopback-only process that serves the version-matched UI and API from a stable local origin and opens the system browser. It is local software, not a hosted service.

## Decision source

- [Choose the v1 user and winning job](.scratch/mdve-v1/issues/01-choose-v1-user-and-winning-job.md)
- [Choose the v1 durability and recovery contract](.scratch/mdve-v1/issues/02-choose-durability-and-recovery-contract.md)
- [Choose the v1 delivery form](.scratch/mdve-v1/issues/03-choose-v1-delivery-form.md)
- [Choose the session and conversation continuity model](.scratch/mdve-v1/issues/04-choose-session-and-conversation-model.md)
- [Choose the v1 structured-diagram boundary](.scratch/mdve-v1/issues/06-choose-v1-structured-diagram-boundary.md)
