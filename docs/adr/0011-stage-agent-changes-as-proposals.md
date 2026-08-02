# Stage agent changes as reviewable proposals

MDVE runs each Codex diagram turn in an isolated candidate workspace containing the current `diagram.mmd` and `AGENTS.md`. The server returns the candidate source after the turn, but does not write it to the durable Diagram source. The workbench compares the candidate with the current semantic model and the user explicitly keeps or rejects it; keeping it commits one normal durable revision against the starting revision.

**Why**

Letting the agent edit the canonical file directly makes a Keep/Reject control cosmetic: by the time the user sees the result, the change is already durable. A temporary workspace keeps the existing agent lease and file-based Codex contract while making the review boundary real and preserving Mermaid as the only durable source.

**Consequences**

- A completed turn can be rejected without creating a compensating revision or mutating the canonical source.
- Accepting a proposal is optimistic-concurrency checked against the revision the agent started from, so an unrelated edit cannot be silently overwritten.
- A proposal is intentionally workbench-scoped; closing the workbench before keeping it discards the candidate while the durable source remains safe.
- The existing recovery point and turn records still document the agent attempt, while the kept source is recorded as a user-accepted durable revision.
