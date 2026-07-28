# MDVE v1 product direction

Status: resolved
Label: wayfinder:map

## Destination

A build-ready v1 strategy and release plan for MDVE as a trustworthy local Mermaid workspace: a developer can create, safely edit, recover, organize, and ask Codex to transform diagrams without silent data loss or hidden agent failure.

## Notes

- Optimize for repeated real work, not demo breadth.
- Reliability, recovery, accessibility, and transparent agent state are release behavior.
- Silent data loss is a release blocker and may be repaired immediately rather than waiting for the map to finish.
- Prefer the existing local-first, file-backed architecture until evidence requires a hosted service.
- Use live browser behavior, deterministic tests, and production builds as evidence.
- After the map is clear, collapse its decisions through `/to-spec`, `/to-tickets`, and `/implement`.

## Decisions so far

<!-- One linked gist per resolved decision ticket. -->

- [Choose the v1 user and winning job](issues/01-choose-v1-user-and-winning-job.md) — Serve Linux software engineers and technical founders who already use Mermaid and Codex; win the repeated job of turning technical reasoning into trustworthy, versionable flowcharts through agent, visual, and source editing in one local workspace.
- [Choose the v1 durability and recovery contract](issues/02-choose-durability-and-recovery-contract.md) — Keep `diagram.mmd` canonical while acknowledged revisions, recoverable drafts, user-visible recovery points, conditional writes, and persisted agent-turn recovery prevent silent loss.
- [Choose the v1 delivery form](issues/03-choose-v1-delivery-form.md) — Ship one loopback-only local web application launched by an `mdve` CLI; defer a desktop wrapper until a proven native-only need justifies a second release surface.
- [Choose the session and conversation continuity model](issues/04-choose-session-and-conversation-model.md) — Organize a flat library of durable Diagrams, each with one source/history timeline and multiple persistent Conversations; make archive reversible and keep provider-thread identity distinct from the transcript.
- [Choose the v1 structured-diagram boundary](issues/06-choose-v1-structured-diagram-boundary.md) — Keep trustworthy structured visual editing flowchart/graph-only; other Mermaid grammars remain source-only, and unsafe mutations stop at opaque syntax rather than partially rewriting it.
- [Choose the v1 installation, update, and adoption path](issues/07-choose-v1-installation-update-and-adoption-path.md) — Deliver one versioned npm package with a global `mdve` executable, explicit stable/prerelease channels, version-pinned rollback, redacted diagnostics, and a strict rule that package lifecycle operations never mutate or delete `~/.mdve` data.
- [Choose the v1 agent-provider boundary](issues/08-choose-v1-agent-provider-boundary.md) — Keep v1 Codex-only, bind every Conversation to one Agent provider and opaque provider-thread identity, and require a new Conversation from the current durable Diagram revision for any future provider change.
- [Choose the v1 package license and commercialization boundary](issues/09-choose-v1-package-license-and-commercialization-boundary.md) — Publish a free-of-charge, pre-commercial npm artifact under counsel-reviewed PolyForm Perimeter 1.0.1 while source stays private, entitlements stay absent, and paid or enterprise Codex positioning waits for explicit clearance.
- [Define the v1 release gates](issues/05-define-v1-release-gates.md) — Require one immutable candidate to pass categorical product/security, reliability/fidelity, accessibility, performance, installation, legal, and release-evidence gates; planning-PR CI exceptions never waive the v1 contract.

## Not yet specified

- No known untracked fog.

## Out of scope

- Cloud accounts, hosted synchronization, and real-time multi-user collaboration for the first trustworthy local v1.
- Mobile editing before the desktop workflow has proven repeated use.
- Replacing Mermaid's layout engine with free-form canvas positioning.
