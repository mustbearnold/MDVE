# Choose the v1 package license and commercialization boundary

Type: grilling
Status: resolved
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
- Codex app-server requires integrations to identify their client, and its
  documentation asks new enterprise integrations to contact OpenAI for known-client
  registration; commercialization may not imply enterprise support before that
  relationship and the applicable terms are confirmed.
- Monetization should not weaken local ownership, offline use after installation,
  recovery, or rollback guarantees.

## Answer

### Decision

Publish `mdve` as an **unscoped public npm package** while keeping the GitHub
source repository private. License the official v1 release artifact under the
**PolyForm Perimeter License 1.0.1**, subject to qualified legal review before
the first publish. Describe the package as **free of charge and deliberately
pre-commercial**. It is not open source, a free-software release, or a paid
product.

PolyForm Perimeter permits use, modification, new works, and distribution for
any purpose except providing others a product that competes with MDVE. That
gives an individual or company broad personal and internal commercial use
without a seat limit, payment condition, license key, or online entitlement,
while restricting a recipient from providing others a product that competes
with MDVE. Under the license's explicit competition rule, a product competes
when the recipient uses the licensed artifact to market it as a substitute for
MDVE's functionality or value, even under another interface, platform,
language, or price. It does not prohibit independently developed competition
that does not use the artifact within that boundary, or limit fair-use rights.

Perimeter also grants a patent license covering licensable claims that use of
the artifact would infringe. That patent license ends if the recipient makes a
written claim that the software infringes or contributes to infringement of a
patent. If the recipient's company makes such a claim, the recipient's patent
license ends only for work on behalf of that company. That patent-defense
condition is a material part of the selected boundary, not boilerplate to omit
from release review.

The package metadata must use:

```json
{
  "license": "SEE LICENSE IN LICENSE.md"
}
```

The current SPDX License List does not include PolyForm Perimeter, and npm
documents `SEE LICENSE IN` for unlisted or custom terms. The tarball must include
the unmodified official license text at top-level `LICENSE.md`, an accurate
copyright/artifact notice, and all notices required by third-party dependencies.
MDVE's terms govern only the MDVE release artifact; dependency licenses keep
their own scope, and user Diagrams, Mermaid source, recovery material, and agent
output are not relicensed as MDVE software.

Qualified counsel must approve the exact artifact scope, notice, mandatory-law
interaction, competition boundary, patent grant and patent-defense termination,
termination/cure behavior, and obtained-copy survival before `private: true` is
removed or any package is published. This decision selects the product
boundary; it does not claim that the current
repository already grants these rights or substitute for legal advice.

### Pre-commercial v1 contract

V1 has no MDVE account, checkout, price, subscription, paid tier, license key,
activation, telemetry identity, recurring entitlement check, or support SLA.
Users install and authenticate their own supported Codex runtime under their own
OpenAI entitlement; Codex access, credentials, credits, and service support are
not included, collected, pooled, proxied, transferred, or resold by MDVE.

A published v1 artifact remains usable offline under the terms shipped with that
version. MDVE must not remotely disable it or retroactively add a payment check.
Future releases may adopt different pricing or terms only prospectively and
with an explicit change; update and rollback stay user-controlled.

This posture validates repeated use and willingness to pay before adding the
identity, purchasing, entitlement, refund, recovery, and support failure modes
of a paid local product. It also avoids claiming that a paid or enterprise Codex
integration is cleared: OpenAI documents app-server for product embedding and
requires every client to identify itself, but asks enterprise integrations to
obtain known-client registration and its public terms do not clearly resolve a
paid wrapper around subscription-authenticated app-server. MDVE must identify
itself honestly from the first public build, make no OpenAI endorsement or
enterprise-support claim, and obtain current OpenAI and legal confirmation
before paid or enterprise positioning.

### Release evidence handed to the release-gates decision

- Inspect both `npm pack --dry-run` and the produced tarball against an exact
  allowlist, including source maps, secrets, `LICENSE.md`, notices, README, and
  build metadata. The current dry run still exposes development and planning
  files, so the existing package is not the selected release artifact.
- Recheck the unscoped `mdve` registry name immediately before release. It
  returned `E404` on 2026-07-28, which is current availability evidence, not a
  reservation.
- Publish with npm trusted publishing from the exact private GitHub repository
  and record `trusted publisher: yes; public source provenance: unavailable`.
  A manifest and checksum establish artifact identity, not public source-to-build
  provenance.
- Audit direct and transitive licenses and copyright ownership before packing;
  MDVE's license cannot override third-party terms.
- Prove that install, use after install, recovery and restore, update, rollback,
  and uninstall do not depend on payment, MDVE identity, activation, or
  continued MDVE network access.

### Options considered

| Option | User rights | Commercial boundary | Decision |
| --- | --- | --- | --- |
| PolyForm Perimeter 1.0.1, free-of-charge v1 | Broad personal and business use, changes, noncompeting distribution, and a patent grant with patent-defense termination | Restricts providing a competing product; using the artifact to market a substitute is the explicit competition test | **Choose, subject to counsel** |
| PolyForm Internal Use 1.0.0 | Internal business use and changes; no distribution; unrelated personal use is not explicit | Strong control but too narrow for the target user | Reject |
| Custom proprietary artifact license | Can express every desired edge exactly | Bespoke drafting and enforcement risk before product proof | Fallback only if counsel finds a material Perimeter mismatch |
| Elastic-2.0 or Apache-2.0 | Broad use, changes, and redistribution | Allows competing local redistribution; Apache also commits the artifact to an open-source model when preferred source is published | Defer unless the business model deliberately changes |
| Paid proprietary v1 | Rights could follow a purchased entitlement | Adds identity, payment, recovery, and OpenAI-terms risk before repeated-value evidence | Reject for v1 |

`UNLICENSED` and silence are not viable public-package policies: they withhold a
usable grant instead of defining one.

### Evidence and trade-offs

- npm documents that [public packages can be downloaded by
  anyone](https://docs.npmjs.com/about-public-packages/), while private packages
  require scoped access. Public visibility therefore preserves the chosen
  frictionless install path but cannot enforce payment.
- npm's current [`package.json` license
  guidance](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license)
  says packages should specify a license and provides `SEE LICENSE IN` for
  unlisted terms; MDVE makes that recommendation a release requirement to avoid
  an ambiguous public grant.
- [PolyForm Perimeter
  1.0.1](https://polyformproject.org/licenses/perimeter/1.0.1) supplies the
  focused noncompete grant; it is deliberately not presented as OSI-approved.
- npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/) supports
  private GitHub repositories but cannot generate public provenance from them.
- OpenAI's [Codex app-server
  documentation](https://developers.openai.com/codex/app-server) supports product
  embedding, requires `clientInfo`, and requires contact for an enterprise known
  client; that is technical integration evidence, not a paid-wrapper legal grant.
- The complete facts, inferences, alternatives, and legal uncertainties are in
  the [primary-source research
  report](../../../docs/research/2026-07-28-v1-package-license-commercialization-boundary.md).

The chosen boundary gives up an open-source adoption claim and delays revenue.
In return, recipients get broad, explicit local-use rights with no entitlement
dependency, the private repository and restriction on using the artifact to
market and provide a competing substitute remain meaningful, and MDVE can learn
from real v1 use before choosing a paid model.

Confidence: **high (0.90)** on the product boundary and **not asserted** on final
legal sufficiency until qualified counsel accepts the exact release terms.

## Comments

- Claimed for the Wayfinder session on 2026-07-28. GitHub mirror:
  [Choose the v1 package license and commercialization boundary](https://github.com/mustbearnold/MDVE/issues/7).
