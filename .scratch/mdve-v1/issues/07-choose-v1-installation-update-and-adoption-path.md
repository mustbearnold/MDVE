# Choose the v1 installation, update, and adoption path

Type: grilling
Status: resolved
Blocked by: 03

## Question

Which artifact and initial distribution channel should deliver the `mdve` CLI
to Linux Codex users, and how should install, upgrade, rollback, diagnostics,
and first-run onboarding work without risking existing sessions or recovery
drafts?

## Evidence to use

- The chosen v1 delivery form is one local web application launched by an
  `mdve` CLI; a desktop wrapper is not a supported v1 form.
- The current package is private, declares no executable or packaged-file
  boundary, and starts TypeScript through a development dependency, so it is not
  yet a distributable release artifact.
- The primary user already uses Linux, a terminal, and the Codex CLI, but v1 may
  not require a repository checkout, two development processes, or manual URL
  discovery.
- The UI and server must remain version-matched, ordinary restarts must preserve
  the browser origin, and upgrades or rollback must not corrupt `~/.mdve` or
  strand recoverable drafts.
- Candidate paths include an npm-installed CLI, a self-contained binary or
  tarball, distro-specific packages, or a deliberately phased combination.

## Answer

Ship MDVE v1 as one versioned npm package with a global `mdve` executable. The
supported persistent installation is:

```sh
npm install --global mdve@latest
```

The package is the release artifact: it contains the launcher, compiled server,
production UI, and only production runtime dependencies. It must not require a
repository checkout, `tsx`, separate web/server processes, or a network request
after installation to obtain its version-matched UI. The GitHub repository
remains private; publishing the npm artifact waits on the package-visibility and
licensing decision surfaced below.

### Release-channel contract

- `latest` identifies the current stable release; `next` is the only supported
  prerelease channel.
- Updating is the same explicit command as installation. MDVE may notify that an
  update exists, but it never silently mutates its own executable.
- Rollback installs an explicit known-good version with
  `npm install --global mdve@<version>`. Published versions are immutable.
- Uninstall removes code, not `~/.mdve`. User data has a separate explicit
  removal flow and is never deleted by npm lifecycle scripts.
- `npx mdve@<version>` may be documented as a temporary evaluation or diagnostic
  path, but it is not a second supported installation model.

This uses npm's standard [`bin` executable
mapping](https://docs.npmjs.com/cli/configuring-npm/package-json/), global
installation, immutable versions, and [distribution
tags](https://docs.npmjs.com/adding-dist-tags-to-packages/) instead of inventing
an updater. Linux users should install Node through a user-owned version manager
or prefix rather than granting npm root access, following npm's [global-install
guidance](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/).

### CLI and first-run contract

- `mdve` preflights a supported even-numbered Node LTS release, Linux, the Codex
  CLI, Codex authentication, a writable MDVE data directory, and the stable
  loopback port before opening the browser.
- The default origin is `http://127.0.0.1:8787`. A collision produces an
  actionable error; MDVE does not silently change the durable origin. `--port`
  is an explicit advanced override and `--no-open` supports headless launch.
- The launcher passes a short-lived, one-use bootstrap secret in the first local
  URL. The server exchanges it for an HttpOnly, SameSite session cookie and
  redirects to a clean URL. API requests reject unauthenticated callers and
  invalid Host or Origin values.
- A successful first run opens a Welcome state that can open an existing `.mmd`
  file, create a starter Diagram, or explain the local data location. It creates
  no telemetry identity and sends no usage data by default.
- `mdve version` reports the package, UI, server, Node, and Codex versions.
  `mdve doctor` checks launch prerequisites without changing user data, and
  `mdve doctor --json` emits a redacted, shareable diagnostic record.

### Update and rollback safety

Installed code and `~/.mdve` are separate. Persisted data carries an explicit
schema version. An older binary that encounters newer unsupported data refuses
all writes and explains which compatible MDVE version is required. Any migration
that cannot remain backward-readable first creates a checksummed recovery
snapshot, then commits transactionally. Installing, updating, rolling back, or
uninstalling the npm package must never rewind, overwrite, or delete Diagram
workspaces, durable revisions, Conversations, or recovery drafts.

### Package and release requirements

The current package is not publishable: `npm pack --dry-run` includes development
and planning files, excludes the ignored production UI, declares no `bin`, and
starts TypeScript through `tsx`. Before release it must:

1. compile the server to JavaScript and build the UI before packing;
2. use an exact `files` allowlist for the launcher, server output, UI output, and
   essential release documentation;
3. declare the `bin`, supported Node LTS engines, repository, and the
   license/terms selected by the follow-up decision;
4. pass tarball-content inspection, clean temporary-prefix installation, live
   launch/API/browser smoke, update, rollback, uninstall-with-data-retention, and
   diagnostic-redaction tests; and
5. publish through GitHub Actions trusted publishing with OIDC after the current
   Actions billing block is cleared, avoiding a long-lived npm token.

Trusted publishing supports a private GitHub repository, but npm cannot generate
public provenance for a package built from that private source repository. That
limitation must be visible in release evidence, not implied away. See npm's
[trusted-publishing](https://docs.npmjs.com/trusted-publishers/) and
[provenance](https://docs.npmjs.com/generating-provenance-statements/)
documentation.

### Why not the alternatives

- A Node single-executable application would remove the Node prerequisite, but
  the supported Node 22 mechanism remains active-development technology and
  requires bundling one CommonJS entry plus embedded assets. It also creates a
  platform, architecture, libc, signing, and updater matrix before adoption
  proves that Node is the limiting friction.
- A `.deb` or apt repository adds distro policy, repository hosting, signing,
  privileged installation, and another update channel.
- A curl-to-shell installer would add an avoidable supply-chain surface and
  bespoke update infrastructure.
- A repository tarball preserves the current developer setup instead of
  delivering a product.

The npm path is the smallest single release surface that gives the chosen user a
real `mdve` command, version pinning, update, and rollback while preserving the
one-process local-web architecture. Revisit a self-contained binary only if
measured onboarding failures show the supported-LTS prerequisite materially
blocks adoption.

Confidence: **0.91**. The unresolved risk is commercial rather than technical:
the frictionless npm artifact is publicly downloadable, while the repository is
private and no package license or v1 pricing boundary exists yet.

## Comments
