# V1 package license and commercialization boundary research

**Research date:** 2026-07-28
**Ticket:** `.scratch/mdve-v1/issues/09-choose-v1-package-license-and-commercialization-boundary.md`
**Question:** Which visibility and license should govern a publicly downloadable `mdve`
npm artifact built from a private GitHub repository, and should v1 be free, paid, or
deliberately pre-commercial?

This is product and technical research, not legal advice. Application of any license and
the OpenAI commercial-integration boundary require qualified legal review.

## Recommendation

Publish `mdve` as an **unscoped public npm package** while keeping the GitHub repository
private. Make v1 **deliberately pre-commercial and free of charge** under a
counsel-reviewed **PolyForm Perimeter License 1.0.1** applied to the official release
artifact. Perimeter permits any purpose except providing others a product that competes
with MDVE. Its grant covers use, changes, new works, and distribution for permitted
purposes, so it covers both personal use and ordinary internal commercial work without a
seat limit, payment condition, license key, or online entitlement in the license text.
Its competition definition restricts a recipient from using the licensed software to
provide a product marketed as a substitute even when that product uses a different
interface, platform, or language or is free of charge. It does not prohibit independently
developed competitors or limit fair-use rights.

Perimeter also grants a patent license covering licensable claims that use of the software
would infringe. That patent license ends if the recipient or their company makes a written
patent-infringement claim about the software. Counsel must assess that patent-defense
termination as a material condition of the chosen license.

Perimeter is a standardized non-open-source license, not an OSI-approved license. It does
not make the private repository or absent preferred source public. MDVE must describe v1
as **free of charge under PolyForm Perimeter 1.0.1**, never as open source or free
software. Product design should separately guarantee no MDVE account, activation,
telemetry, recurring entitlement check, or continued network access.

Use `"license": "SEE LICENSE IN LICENSE.md"` and ship the unmodified Perimeter 1.0.1
text as top-level `LICENSE.md`. The current SPDX License List 3.28.0 contains neither
PolyForm Perimeter nor PolyForm Internal Use, while npm reserves SPDX expressions for
listed identifiers and documents `SEE LICENSE IN` for unlisted or custom terms. Do not
use `UNLICENSED`: npm documents it for private or unpublished packages when no use rights
are granted, while this package intentionally grants public recipients use rights. See
npm's [`package.json` license rules](https://docs.npmjs.com/cli/configuring-npm/package-json/#license),
the [current SPDX License List](https://spdx.org/licenses/), and the
[official Perimeter 1.0.1 text](https://polyformproject.org/licenses/perimeter/1.0.1).

Qualified counsel must confirm that the exact, unmodified terms achieve the intended
boundary in applicable jurisdictions. Release material must identify the licensed
"software" as the official npm artifact without modifying the standardized license, keep
private repository-only material outside that scope, preserve third-party licenses, and
state that user Diagrams, Mermaid source, recovery material, and agent output are not MDVE
software. Counsel should also confirm how Perimeter treats mirrors, archival copies,
internal company copying, security research, and redistribution of an unmodified artifact.

This choice preserves private source and a later paid-product option while giving users
more explicit inspection, modification, and noncompeting distribution rights than a
closed binary EULA. A future pricing change must be forward-looking; release copy should
promise that MDVE will not remotely disable an already installed v1 artifact.

## Confirmed registry and packaging facts

### Public visibility is the frictionless path

npm says public packages can be downloaded by anyone. Unscoped packages are always
public; private packages are always scoped and can only be downloaded by users who have
been granted read access. The unscoped `mdve` name therefore matches the already chosen
`npm install --global mdve@latest` path without introducing registry authentication.

Primary sources:

- [npm: About public packages](https://docs.npmjs.com/about-public-packages/)
- [npm: Package scope, access level, and visibility](https://docs.npmjs.com/package-scope-access-level-and-visibility/)
- [npm: Installing public and private packages](https://docs.npmjs.com/downloading-and-installing-packages-locally/)

`package.json` currently has `"private": true`; npm refuses to publish a package with
that field set. That flag controls npm publication, not GitHub repository visibility.
It should be removed only as part of the release-hardening change, after license and
tarball gates exist. See npm's [`private` field documentation](https://docs.npmjs.com/cli/configuring-npm/package-json/#private).

### Every packed file becomes public

The package is a gzip tarball, and npm makes a public package and its metadata available
to everyone online. A `files` allowlist limits the payload, but `package.json`, README,
LICENSE, and files named by `main` or `bin` are always included. `npm pack --dry-run`
shows the effective contents. Source maps also need explicit inspection because a
production bundle can embed original sources even when `.ts` and `.tsx` files are absent.

Primary sources:

- [npm: Package formats](https://docs.npmjs.com/about-packages-and-modules/)
- [npm: Files included in a published package](https://docs.npmjs.com/cli/publish/#files-included-in-package)
- [npm privacy Q&A: public package data is available to everyone](https://docs.npmjs.com/policies/privacy/)

The release gate should therefore inspect both the dry-run listing and the produced
tarball, rather than infer privacy from the repository or `.gitignore`.

### Public npm does not require an open-source license

npm calls its free registry terms the "Open Source Terms," but those terms welcome
packages ranging from hobby projects to competitive products and enterprise tooling.
They explicitly allow README information about paid products, commercial license terms,
training, integration, and support. Package contents remain independently licensed by
their publishers. Publication gives npm the rights it needs to distribute the tarball;
the package's own license determines recipients' additional rights.

Primary sources:

- [npm Open Source Terms: commercial content](https://docs.npmjs.com/policies/open-source-terms/#commercial-content)
- [npm license: registry packages are independently licensed](https://docs.npmjs.com/policies/npm-license/)
- [npm privacy Q&A: publication and package-license effects](https://docs.npmjs.com/policies/privacy/)

A public package is therefore an access decision, not an open-source declaration and
not a payment mechanism. Anyone can obtain the tarball; a paid proprietary package would
need a separate legal or technical entitlement boundary.

### Trusted publishing works, public provenance does not

npm trusted publishing can authenticate GitHub Actions with short-lived OIDC rather
than a long-lived npm token. For GitHub publishing, `repository.url` must exactly match
the GitHub repository. Private repositories are supported, but npm does not generate a
provenance statement from a private repository even when the package is public.

Primary source: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Consequences for MDVE:

1. Keep trusted publishing and the exact private repository URL in package metadata.
2. State **"trusted publisher: yes; public source provenance: unavailable"** in release
   evidence instead of displaying a provenance claim.
3. Publish a package-content manifest and checksum as release evidence, while recognizing
   that these prove artifact identity, not a publicly inspectable source-to-build chain.
4. Treat the commit id embedded in build metadata as owner-audit information; outsiders
   cannot verify a commit they cannot access.

npm also treats published version data as immutable and heavily limits later unpublishing.
Downloaded copies cannot be recalled. License scope and tarball contents must therefore be
correct before the first stable publication. See the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

## Viable license options

| Option | Rights and source consequence | Commercial consequence | Fit |
| --- | --- | --- | --- |
| **A. PolyForm Perimeter 1.0.1; free-of-charge v1** | Permits use, modification, new works, and distribution for every purpose except providing others a product that competes with MDVE. The license's explicit competition rule applies when a recipient uses the artifact to market a substitute for MDVE's functionality or value. It also grants a patent license that terminates on a written patent-infringement claim about the software. This covers personal and internal commercial use and does not require source publication. It is not on SPDX 3.28.0 and is not OSI-approved. | Restricts provision of free or paid competing products across deployment forms while leaving independent competition that does not use the artifact within that boundary, and noncompeting use, untouched. Future paid versions remain possible without a v1 entitlement system. | **Recommended, subject to counsel.** Strongest standard-term match for private source, public artifact, broad use, and an artifact-use competitive boundary. |
| **B. PolyForm Internal Use 1.0.0** | Permits internal business operations and internal modifications but forbids recipient distribution. Its text does not expressly name unrelated personal use as a permitted purpose. It is not on SPDX 3.28.0 and is not OSI-approved. | Stronger control than Perimeter, but no focused competition test and a narrower user grant. Personal use would need a second license or clarification, defeating the value of standard terms. | Not recommended for MDVE's broad personal-plus-work use case. If chosen, metadata should also use `SEE LICENSE IN LICENSE.md`. |
| **C. Custom release-artifact license** | Can state personal/internal-business execution, backup, offline survival, security research, outputs, and artifact-only scope exactly while withholding redistribution. | Maximizes future flexibility, but creates bespoke drafting, interpretation, and international-enforcement risk. | Viable fallback only if counsel finds a material Perimeter mismatch. |
| **D. Elastic License 2.0** | ELv2 grants use, copying, distribution, availability, and derivative works, while restricting hosted/managed-service use, license-key circumvention, and removal of notices. It has SPDX id `Elastic-2.0` but is not OSI-approved. Without preferred source, do not call the artifact source-available. | Allows internal commercial use and competing local redistribution; its main competitive protection targets managed services, which is not MDVE's v1 delivery form. | Viable but weaker than Perimeter for a local-product moat. Use `"license": "Elastic-2.0"` if chosen. |
| **E. Apache-2.0 with preferred source in the package** | Apache-2.0 is SPDX-listed and OSI-approved, grants broad copyright and patent rights, and permits modified or unmodified distribution subject to notice conditions. To call MDVE open source, publish preferred TypeScript/source and build material; compiled bundles alone are insufficient. | Maximizes verifiability and forkability but permits competing products and commercial redistribution. Released rights cannot become exclusive later. | Viable only if MDVE consciously chooses an open-source model. Use `"license": "Apache-2.0"` if chosen. |

Primary license sources:

- [PolyForm Perimeter 1.0.1](https://polyformproject.org/licenses/perimeter/1.0.1)
- [PolyForm Internal Use 1.0.0](https://polyformproject.org/licenses/internal-use/1.0.0)
- [Elastic License 2.0](https://www.elastic.co/licensing/elastic-license)
- [OSI-approved Apache License 2.0](https://opensource.org/license/apache-2-0)
- [OSI definition and source requirement](https://opensource.org/osd)

Business Source License 1.1 is a poor v1 fit. Its default grant covers
non-production use and requires an Additional Use Grant to permit production use, while
MDVE's winning job is real work. It also requires eventual conversion to a GPL-compatible
Change License no later than four years after first public distribution. A carefully
drafted Additional Use Grant could make it viable, but it adds ambiguity without improving
the recommended boundary. See the [BSL 1.1 text](https://mariadb.com/bsl11/) and
[MariaDB's BSL FAQ](https://mariadb.com/bsl-faq-mariadb/).

GitHub notes that absent a license, default copyright law retains rights and does not grant
others general reproduction, distribution, or derivative-work permission. Publishing a
tarball without explicit recipient terms would therefore create avoidable ambiguity, not
a sound proprietary policy. See [GitHub's repository licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

## Free, paid, or deliberately pre-commercial

### Recommended: deliberately pre-commercial

V1 should have no price, paid tier, license key, account, checkout, subscription, support
SLA, or enterprise-support claim. "Pre-commercial" should mean that MDVE is validating
repeated use and willingness to pay, not that the artifact expires or is limited to toy
work. The version-bundled license plus an explicit no-remote-disable product promise lets
early users keep working even if future releases change terms.

This is an evidence-based product inference:

- the package does not yet satisfy its release-artifact contract;
- no evidence in the Wayfinder record establishes repeated adoption or willingness to pay;
- billing and entitlement would add failure modes to install, offline use, recovery, and
  rollback; and
- the OpenAI commercial-integration boundary is not yet confirmed.

### Why not paid v1

The public registry cannot limit tarball downloads to purchasers. A paid v1 would need one
of these additional boundaries: honor-system commercial licensing, online activation,
periodic entitlement checks, or an offline signed license file. The latter best preserves
offline operation, but all four add purchasing, identity, recovery, refund, support, and
enforcement work before the product has demonstrated repeated use.

If evidence later supports charging, the least disruptive local-first model is a one-time
or major-version license represented by a locally verifiable signed entitlement that does
not phone home after issuance. That is a future hypothesis, not a v1 commitment.

### Why not Apache-2.0 immediately

Apache-2.0 maximizes verifiability and community autonomy and includes an express patent
grant, but it permits modified and unmodified commercial redistribution. That grant is
rational only if MDVE consciously chooses an open-source business model and publishes
preferred source. A private GitHub UI does not preserve exclusivity once complete source
ships in the public npm tarball.

## OpenAI and Codex integration boundary

### Confirmed facts

OpenAI explicitly documents app-server as the interface for embedding Codex into a product,
and its SDK documentation includes integrating Codex into an application. App-server
initialization requires `clientInfo`; OpenAI says `clientInfo.name` identifies the client
for Compliance Logs and asks new integrations intended for enterprise use to contact
OpenAI for addition to a known-clients list.

Primary sources:

- [OpenAI Codex app-server](https://developers.openai.com/codex/app-server)
- [OpenAI Codex SDK](https://developers.openai.com/codex/sdk)

The current command reference nevertheless marks `codex app-server` **Experimental**, says
it is primarily for development and debugging, and warns that it may change without notice.
MDVE's chosen stdio transport avoids app-server's additional unsupported-WebSocket risk,
but it does not remove the overall compatibility risk. See [OpenAI's Codex developer command
reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-app-server).

Codex supports a user's own ChatGPT subscription sign-in or API key for local work; those
methods have different billing and governance. The OpenAI Services Agreement prohibits
credential sharing, account-access resale, and API-key transfers. OpenAI's consumer Terms
also prohibit selling or distributing OpenAI's Services and automatic/programmatic
extraction, while the app-server documentation affirmatively describes product embedding.
The public sources do not resolve how those provisions apply to charging for a third-party
local wrapper around a user's subscription-authenticated app-server.

Primary sources:

- [OpenAI Codex authentication](https://developers.openai.com/codex/auth)
- [OpenAI Services Agreement](https://openai.com/policies/services-agreement/)
- [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/)

### MDVE boundary and inference

V1 should be bring-your-own Codex: every user installs and authenticates their own supported
Codex runtime, pays OpenAI separately under their own entitlement, and keeps credentials
inside Codex. MDVE must not collect, pool, proxy, transfer, include, or resell OpenAI
accounts, credentials, credits, or service access. Product copy should say **"Codex access
not included."**

A free local integration of that shape is structurally different from reselling OpenAI
access, but that is a technical and product inference, not a legal conclusion. Before MDVE
charges for Codex-integrated software or promises enterprise support, obtain current terms
confirmation from OpenAI and known-client registration where applicable. Identify MDVE
honestly in `clientInfo` from the first public build regardless of price.

The Apache-2.0 license on OpenAI's Codex source permits use and distribution of that source
subject to its terms; it does not grant service entitlements, enterprise support, trademark
rights, or permission to resell OpenAI service access. See the [pinned Codex Apache-2.0
license](https://github.com/openai/codex/blob/8e271dc02b23d42827875019924be0f5005642b0/LICENSE).

## Required follow-up gates

1. Have qualified counsel review unmodified PolyForm Perimeter 1.0.1 for MDVE's exact
   artifact scope, including mandatory consumer rights, personal/internal use, security
   research, redistribution, competition, its patent grant and patent-defense termination,
   termination/cure, and obtained-version survival.
2. Audit copyright ownership plus all direct and transitive dependency licenses; ship the
   required notices and keep third-party components outside MDVE's proprietary grant.
3. Add a tarball test that verifies the exact allowlist, scans source maps and bundles for
   private source or secrets, and confirms `LICENSE.md`, README, manifest, and build metadata.
4. Configure trusted publishing from the exact private repository and record the missing
   public provenance limitation in every release evidence set.
5. Before paid or enterprise positioning, obtain OpenAI's current commercial-integration
   confirmation and known-client registration, then rerun the app-server compatibility gate
   against the supported Codex version.

Legal uncertainties remain around international consumer law, Perimeter's exact scope and
enforceability for an npm artifact, contributor ownership, trademark clearance for `MDVE`,
and OpenAI's commercial wrapper terms. This research chooses a product boundary; it does
not determine those legal questions.
