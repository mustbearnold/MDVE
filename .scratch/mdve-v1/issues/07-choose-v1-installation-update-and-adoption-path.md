# Choose the v1 installation, update, and adoption path

Type: grilling
Status: open
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

## Comments
