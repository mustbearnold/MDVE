# Responsive UI workbench de-slop

MDVE is a local React creation workspace for software engineers and technical
founders. Its winning job is turning fuzzy technical reasoning or an existing
Mermaid file into a correct, durable, version-control-ready technical
flowchart.

## Interface thesis

A precise diagram workbench where the live diagram dominates, source and
inspection stay legible, and the agent remains powerful but subordinate.

## Direction

- Keep the dark, dense, split-pane editor identity.
- Use the system UI font and reserve monospace for Mermaid source and technical
  values; do not add network fonts to a local-first product.
- Use one blue interaction accent plus distinct success, warning, and danger
  colors.
- Use borders, alignment, and spacing for hierarchy. The canvas grid is retained
  because it communicates diagram space; decorative gradients, glass, glow,
  shadows, and card soup are excluded.
- Desktop remains a three-column workbench. Narrow layouts expose Preview,
  Source, Inspector, and Agent as explicit workspace views rather than stacking
  squeezed desktop panes.
- Preserve all editing, selection, persistence, import/export, inspector, and
  agent capabilities.

## Evidence baseline — 28-07-26

At 390 by 844 on master `a64346d`, the document and toolbar are 750 pixels wide,
the Diagram selector is 493 pixels wide, and core controls are 27 to 33 pixels
tall. There is no narrow-layout workspace switcher, no page heading, no Preview
or Agent heading, and no consistent visible focus treatment.

The implementation is evaluated against WCAG 2.2, the USWDS design principles,
the GOV.UK Design System layout and spacing guidance, and Core Web Vitals.

## GitHub

- Issue: https://github.com/mustbearnold/MDVE/issues/20
