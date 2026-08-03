# MDVE Context

Canonical product vocabulary for MDVE. Decision rationale lives in the linked Wayfinder ticket rather than in this glossary.

## Product vocabulary

- **Primary user** — An individual Linux software engineer or technical founder who already uses Mermaid or Markdown and Codex.
- **Technical flowchart** — A Mermaid `flowchart` or `graph` used to reason about software architecture, system behavior, incident paths, or implementation work.
- **Winning job** — Turning fuzzy technical reasoning or an existing `.mmd` file into a correct, durable, version-control-ready technical flowchart without copying between separate agent, editor, preview, and whiteboard tools.
- **Diagram workspace** — The durable local container that owns one Diagram's source, metadata, agent instructions, recovery material, and Conversations. User-facing copy calls it a Diagram; avoid the overloaded term “session.”
- **Diagram library** — The active and archived Diagram workspaces a user can search and revisit. Library lifecycle does not change a Diagram's source or recovery history.
- **Conversation** — A durable sequence of agent turns attached to one Diagram workspace and one Agent provider, with at most one provider-thread identity. It always acts on the Diagram's current source and never owns a forked source.
- **Conversation turn** — One user request and its agent progress, response, outcome, and starting and ending durable revisions within a Conversation.
- **Agent provider** — The agent runtime and protocol whose model catalog, turn lifecycle, and provider-thread identity back a Conversation.
- **Provider-thread identity** — An opaque continuation handle owned by one Agent provider and bound to one Conversation; it is not the Conversation transcript.
- **Archive** — A reversible visibility state for a Diagram or Conversation that retains source, history, transcript, and provider continuity. Archive is not Trash or permanent deletion.
- **Source of truth** — `diagram.mmd`; rendered views and the source-backed Semantic diagram model derive from this file and must not maintain a competing persistent diagram model.
- **Durable revision** — A monotonically numbered `diagram.mmd` version that MDVE has atomically written, flushed to local disk, and acknowledged as **Saved**.
- **Recovery draft** — The browser-journaled latest source that has not yet become a durable revision; it exists only to prevent unacknowledged work from being silently lost.
- **Recovery point** — An immutable, checksummed, user-visible snapshot of a durable revision, with its time and origin, that can be restored as a new revision.
- **Agent write lease** — The exclusive interval in which an agent may prepare a diagram proposal; direct source and visual mutation pause until the turn completes, stops, fails, or is recovered as interrupted.
- **Structured edit** — A visual edit that rewrites only the modeled Mermaid statements it changes while preserving opaque source verbatim.
- **Semantic diagram model** — The typed, source-backed graph of modeled nodes, links, identities, and presentation references used by structured editing. It is derived from `diagram.mmd`, carries source provenance, and is never a second durable source.
- **Diagram presentation** — The visual arrangement associated with a Semantic diagram model, including node positions and link-label positions; it is durable only through source-preserving MDVE metadata.
- **Edit transaction** — One named, atomic set of structured operations committed as a single source revision, with an origin and affected nodes and links.
- **Agent proposal** — An agent-origin change produced in an isolated candidate workspace and held at the workbench boundary as a reviewable before/after result; it creates no durable revision until the user keeps it.
- **Source-only Diagram** — A Diagram that renders and remains editable through source or Codex but does not qualify for structured visual mutation. In v1, every Mermaid grammar except `flowchart` and `graph` is source-only.
- **Agent transformation** — A Codex turn that reads and edits a candidate `diagram.mmd` inside an isolated copy of its Diagram workspace and reports a proposal back to the workbench.
- **Local web application** — MDVE's v1 delivery form: an `mdve` CLI starts one loopback-only process that serves the version-matched UI and API from a stable local origin and opens the system browser. It is local software, not a hosted service.
- **Desktop shell** — An Electron window around the same version-matched loopback server and production UI. It owns the native window and server lifecycle but does not create a second diagram model, API, or persistence path.
- **BYOK provider** — A user-configured OpenAI-compatible Agent provider. MDVE stores its endpoint configuration and API key locally with restrictive permissions and never turns the key into a hosted MDVE credential.
- **MDVE Pro entitlement** — A device-local, store-verified license for the current major version. It unlocks paid product capabilities without gating the free local Mermaid workbench.
- **Presentation mode** — A clean, single-canvas desktop view for presenting a Diagram. It is the first MDVE Pro capability.
- **Release artifact** — The versioned npm package that installs the `mdve` executable and contains its version-matched launcher, server, and production UI.
- **V1 release gate** — A non-waivable pass/fail criterion applied to one identified release candidate. MDVE may claim v1 only when every gate passes against the same Git commit and npm tarball recorded by integrity digest.
- **Pre-commercial release** — A public, free-of-charge MDVE release with no billing or license-entitlement mechanism.

## Decision source

- [Choose the v1 user and winning job](.scratch/mdve-v1/issues/01-choose-v1-user-and-winning-job.md)
- [Choose the v1 durability and recovery contract](.scratch/mdve-v1/issues/02-choose-durability-and-recovery-contract.md)
- [Choose the v1 delivery form](.scratch/mdve-v1/issues/03-choose-v1-delivery-form.md)
- [Choose the session and conversation continuity model](.scratch/mdve-v1/issues/04-choose-session-and-conversation-model.md)
- [Choose the v1 structured-diagram boundary](.scratch/mdve-v1/issues/06-choose-v1-structured-diagram-boundary.md)
- [Choose the v1 installation, update, and adoption path](.scratch/mdve-v1/issues/07-choose-v1-installation-update-and-adoption-path.md)
- [Choose the v1 agent-provider boundary](.scratch/mdve-v1/issues/08-choose-v1-agent-provider-boundary.md)
- [Choose the v1 package license and commercialization boundary](.scratch/mdve-v1/issues/09-choose-v1-package-license-and-commercialization-boundary.md)
- [Define the v1 release gates](.scratch/mdve-v1/issues/05-define-v1-release-gates.md)
- [Keep Mermaid durable while introducing the v3 semantic model](docs/adr/0010-keep-mermaid-source-with-semantic-model.md)
- [Stage agent changes as reviewable proposals](docs/adr/0011-stage-agent-changes-as-proposals.md)
- [Fund the desktop product with local-first Pro and BYOK](docs/adr/0012-local-first-pro-entitlement-and-byok.md)
