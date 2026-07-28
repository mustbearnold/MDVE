# Domain Docs

How the engineering skills consume MDVE's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root
- ADRs under `docs/adr/` that touch the area about to change

If these files do not exist, proceed silently. Do not create placeholders. `/domain-modeling`, reached through `/grill-with-docs` and `/improve-codebase-architecture`, creates them lazily when terms or decisions are resolved.

## File structure

MDVE uses one domain context across its server and web surfaces:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
├── server/
└── web/
```

## Use the glossary's vocabulary

When output names a domain concept in an issue title, proposal, hypothesis, or test, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether it is project language or record the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
