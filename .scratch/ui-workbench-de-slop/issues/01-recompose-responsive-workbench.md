# Recompose the responsive React workbench

Type: task
Status: resolved
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

## Answer

Implemented the responsive React workbench described in the spec and GitHub
issue #20.

Evidence on 28-07-26:

- `npm test`: 13/13 pass; `npm run typecheck`, `npm run build`, and
  `git diff --check` pass. Vite retains its non-blocking large-chunk advisory.
- Codex in-app browser: document and toolbar horizontal overflow are zero at
  390x844, 768x1024, 1440x900, and requested 1728x1117 (the renderer reported
  an actual height of 1118 for the last case).
- The 390- and 768-pixel workbenches expose one pane at a time with 44-pixel
  controls; the 1440- and 1728-pixel workbenches expose Source, Preview, and
  the side pane together with compact 36-pixel controls.
- Pointer switching exercises Source, Inspector, and Agent independently with
  one visible pane and no overflow. Enter selects a focusable Mermaid node;
  Space selects a focusable Mermaid link; focused node geometry renders the
  3-pixel blue focus stroke.
- Representative contrast checks pass: control boundary 3.04:1, primary text
  16.68:1, secondary text 10.41:1, muted text 6.79:1, primary action text
  4.57:1, and focus 11.61:1.
- Phone and desktop screenshots were captured and inspected in the Codex
  in-app browser against an existing five-node Diagram.
- Independent Spec, Standards, and evidence/claim-boundary reviews pass after
  findings were addressed.
- Exact implementation-head public CI passed all nine checks in Actions runs
  `30353957023` and `30353957086`: four Node quality lanes, dependency review,
  production audit, validate, JavaScript/TypeScript analysis, and CodeQL.

Core Web Vitals are design constraints only. No LCP, INP, CLS, field-data, or
certification claim is made by this ticket.

## Comments

- 28-07-26: Claimed on branch `codex/issue-20-ui-workbench`.
- 28-07-26: Independent Spec review found that the 768-pixel narrow layout
  retained 36-pixel controls. The full narrow breakpoint now uses 44-pixel
  controls, and the re-review passed.
- 28-07-26: Independent Standards review found overloaded Diagram-workspace
  language, a missing Wayfinder map, and duplicated selection/CSS paths. The UI
  now uses Workbench vocabulary, this session has a map, selection resolution is
  shared, and the final re-review passed.
