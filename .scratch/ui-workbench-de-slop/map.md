# Responsive UI workbench de-slop

## Notes

- One-ticket Wayfinder session for GitHub issue #20.
- Fixed point: `origin/master` at `a64346d45ea09b68d658c057e3535206491f4f3b`.
- Scope is the existing React workbench; no delivery-form or Diagram-workspace
  domain changes.

## Decisions-so-far

- Use a dense, dark, product-specific diagram workbench with one blue
  interaction accent and explicit status colors.
- Preserve the desktop three-pane workbench; use Preview, Source, Inspector,
  and Agent views below 1120 pixels.
- Use system fonts and inline SVG icons to preserve local-first behavior and
  avoid decorative UI dependencies.
- Ticket 01 resolved: the React workbench now has responsive one-view narrow
  composition, preserved three-pane desktop composition, explicit semantic
  controls, keyboard-selectable diagram elements, reduced motion, and measured
  target/overflow/contrast evidence.

## Fog

- None. Ticket 01 is resolved and remains the only ticket in this Wayfinder
  session.

## Tickets

- [01 — Recompose the responsive React workbench](issues/01-recompose-responsive-workbench.md)
