# Recompose the responsive React workbench

Type: task
Status: claimed
GitHub: https://github.com/mustbearnold/MDVE/issues/20

## Outcome

Repair the source-level hierarchy, responsive composition, semantics,
interaction targets, and focus treatment of the MDVE workbench without hiding
or changing real capabilities.

## Acceptance

- No document or toolbar horizontal overflow at 390 by 844, 768 by 1024,
  1440 by 900, or 1728 by 1117.
- Narrow layouts expose one dominant Preview, Source, Inspector, or Agent view
  at a time.
- Core narrow-layout targets are at least 44 pixels.
- Visible focus, semantic headings, accessible control names, and reduced motion
  are implemented and exercised.
- Existing tests, typecheck, build, protected CI, and representative primary
  interactions pass.
- The final UI is inspected in the Codex in-app browser.

## Comments

- 28-07-26: Claimed on branch `codex/issue-20-ui-workbench`.
