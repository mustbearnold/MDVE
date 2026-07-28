# Choose the v1 structured-diagram boundary

Type: grilling
Status: resolved
Blocked by:

## Question

Should trustworthy structured visual editing remain flowchart-only for v1, or should one adjacent Mermaid diagram type receive the same source-preserving manipulation contract?

## Evidence to use

- The chosen winning job is technical flowchart development, not general diagram authoring.
- The current parser and mutator deliberately model `flowchart` / `graph` and preserve unsupported syntax as opaque source.
- Mermaid itself supports many diagram grammars whose editing semantics are materially different.
- Every additional structured grammar expands parser fidelity, mutation safety, accessibility, recovery, and browser test requirements.

## Comments

- 2026-07-28: repaired an immediate boundary violation before closing the
  decision. Unsupported and headerless Mermaid sources now reject structured
  insertion, new flowchart statements stay outside the final subgraph, and
  identity edits refuse opaque node references. Eight deterministic tests pass.

## Answer

### Decision

MDVE v1 provides trustworthy structured visual editing only for Mermaid
`flowchart` and `graph` diagrams. No adjacent Mermaid grammar receives the same
contract in v1.

Every other Mermaid grammar remains a first-class **source-only Diagram**: it may
render, persist, recover, import, export, and be transformed through source or
Codex, but MDVE does not expose node, relationship, shape, or direction controls
that imply semantic understanding it does not have.

Flowchart eligibility is explicit rather than inferred from parseable-looking
lines:

- the source must declare a recognized `flowchart` or `graph` header;
- the requested operation must understand every source relationship it would
  invalidate, otherwise the UI disables it with a reason;
- opaque lines remain byte-preserved, but preservation alone does not authorize
  a rename or deletion when they reference the affected node;
- new nodes and links are inserted at the top level, never accidentally inside
  the final subgraph;
- render errors or missing headers keep the Diagram source-only until corrected.

The trustworthy v1 contract covers node label and supported-shape changes,
collision-safe node id rename, node and link creation/deletion, supported link
label/style changes, and diagram direction. Subgraph syntax, class/style/click
directives, and unmodeled flowchart statements remain source-preserved. Any
structured action whose semantic blast radius crosses that opaque boundary must
be refused rather than partially applied.

V1 release evidence must include a representative flowchart corpus with chains,
all supported shapes and arrows, quoted labels, comments, subgraphs, directives,
reserved ids, opaque statements, imports, undo/redo, recovery, and agent changes.
For every structured mutation, tests must prove both the intended semantic change
and byte preservation outside the affected statement. Unsupported grammars need
negative tests proving the structured controls and mutators cannot change them.

### Options considered

| Option | Winning-job fit | Source-preservation confidence | Accessibility/test surface | Delivery cost | Decision |
| --- | --- | --- | --- | --- | --- |
| Complete and harden flowchart/graph only | High | High | Focused | Medium | Choose |
| Add `stateDiagram-v2` structured editing | Medium | Medium-low | Large | High | Defer |
| Add class or ER structured editing | Medium-low | Low | Large | High | Reject for v1 |
| Build a generic cross-grammar Mermaid AST/editor | Low for v1 | Low until mature | Very large | Very high | Reject |

`stateDiagram-v2` is the closest adjacent candidate because it also displays
states connected by transitions. Its semantics are not flowchart semantics:
`[*]`, composite and concurrent states, aliases, notes, transition labels, and
state-local direction all need grammar-specific identity, containment, mutation,
and accessibility rules. Reusing the flowchart model would create exactly the
hidden source drift MDVE promises to prevent.

Class and ER diagrams are further away. Members, methods, annotations,
cardinality, entity attributes, and typed relationships are not generic nodes and
edges. A generic Mermaid AST would eventually support broader editing, but it is
a platform investment rather than evidence needed for the chosen technical
flowchart job.

### Evidence and trade-offs

- The current parser deliberately recognizes only `flowchart`/`graph` headers
  and converts all known adjacent grammars into opaque lines. The Inspector
  already describes those grammars as source-only.
- Direct probes confirmed sequence, state, class, ER, and mindmap sources produce
  no modeled nodes or edges. Before the repair, **+ Node** still appended
  flowchart syntax to every one of them and `addEdge` did the same.
- The same probe showed new nodes landing inside a final subgraph and node rename
  or deletion leaving opaque `class` and `style` directives behind. These are
  flowchart trust gaps, demonstrating that adding another grammar would be
  premature.
- The immediate repair now enforces the declared boundary at both UI and mutator
  layers, inserts new statements outside closed subgraphs, blocks risky identity
  edits, and passes eight deterministic tests plus type checking.
- The chosen v1 user and winning job are explicitly technical flowcharts. Other
  grammars already retain meaningful value through Mermaid rendering, exact
  source editing, file durability, and Codex transformations.

The cost is that users cannot directly manipulate state, class, ER, or sequence
elements in v1 even when they look graph-like. In return, every structured
control has one testable semantic contract, and the release effort goes toward
making the chosen flowchart workflow trustworthy rather than multiplying partial
editors.

Confidence: **very high (0.97)**. Product fit, current architecture, and direct
failure evidence all point to the same boundary. A future grammar should be
adopted only through a separate decision backed by its own parser/mutator,
accessibility model, preservation corpus, and release gates.
