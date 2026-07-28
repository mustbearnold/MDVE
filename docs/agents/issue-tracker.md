# Issue tracker: Local Markdown

Issues and specs (also known as PRDs) for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`; never use one combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/`, creating the directory when needed.

## When a skill says "fetch the relevant ticket"

Read the referenced file. The user will normally provide its path or issue number.

## Wayfinding operations

Used by `/wayfinder`. The map is one file with one child file per ticket.

- **Map:** `.scratch/<effort>/map.md` contains Notes, Decisions-so-far, and Fog
- **Child ticket:** `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, contains the question; a `Type:` line records `research`, `prototype`, `grilling`, or `task`, and a `Status:` line records `claimed` or `resolved`
- **Blocking:** a `Blocked by: NN, NN` line near the top; a ticket is unblocked when every listed file is `resolved`
- **Frontier:** scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins
- **Claim and resolve:** set `Status: claimed` before work; append the answer under `## Answer`, set `Status: resolved`, and add a context pointer to the map's Decisions-so-far afterward
