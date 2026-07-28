# Limit structured editing to flowcharts

MDVE v1 offers structured visual mutation only for declared Mermaid `flowchart` and `graph` sources; every other grammar remains a first-class source-only Diagram. Reusing flowchart semantics for state, class, ER, or sequence diagrams would create silent source drift, so a future grammar requires its own parser, mutation contract, accessibility model, and preservation corpus as specified in [the structured-boundary decision](../../.scratch/mdve-v1/issues/06-choose-v1-structured-diagram-boundary.md).
