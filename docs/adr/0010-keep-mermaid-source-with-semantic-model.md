# Keep Mermaid source with a source-backed semantic model

MDVE keeps `diagram.mmd` as the durable source and derives a typed Semantic diagram model for v3 structured editing, transactions, and agent proposals. A persistent sidecar model would split source ownership and introduce migration/export drift; source-only mutation would leave canvas, outline, and agent behavior with duplicated semantics. The derived model therefore carries source provenance, delegates serialization to source-preserving mutators, and refuses operations that cross opaque Mermaid syntax.

**Consequences**

- Structured UI actions share one model and Edit transaction boundary.
- Mermaid remains portable, inspectable, and the only durable diagram source.
- Unsupported grammar remains renderable and source-editable, but does not silently enter the structured model.
