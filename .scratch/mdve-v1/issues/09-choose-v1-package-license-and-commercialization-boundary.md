# Choose the v1 package license and commercialization boundary

Type: grilling
Status: open
Blocked by: 07

## Question

Which visibility and license should govern the publicly downloadable `mdve` npm
artifact while its GitHub source repository remains private, and should the v1
release be free, paid, or deliberately pre-commercial?

## Evidence to use

- Frictionless installation requires a public npm package; a private npm package
  would require registry authentication for every user.
- The user explicitly requires the GitHub repository to remain private.
- The repository has no `LICENSE` file and `package.json` has no `license` field.
- A public npm artifact exposes every packed file even when its source repository
  is private, so the package needs explicit terms rather than accidental
  ambiguity.
- npm trusted publishing works from a private GitHub repository, but public
  provenance cannot be generated from that private source.
- Monetization should not weaken local ownership, offline use after installation,
  recovery, or rollback guarantees.

## Comments
