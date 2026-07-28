# Define the v1 release gates

Type: grilling
Status: resolved
Blocked by: 03, 04, 06, 07, 08, 09

## Question

Which measurable product, reliability, accessibility, performance, and installation checks must pass before MDVE can be called v1?

## Evidence to use

- Type checking and production build pass; `npm test` now covers the save reliability seam, but parser, API, agent-run, and browser regression coverage remain open.
- The production bundle warns about JavaScript chunks over 500 kB.
- Live DOM inspection shows several icon-only controls expose symbols rather than descriptive accessible names.
- Core risks include file durability, agent cancellation/recovery, parser fidelity, responsive use, and a reproducible install path.
- The Codex-only contract requires compatibility gates for app-server schema and
  initialization, ChatGPT auth state, model discovery, new and resumed threads,
  streamed turn persistence, interruption, unavailable-thread recovery, and
  immutable Conversation-to-provider binding.

## Answer

### Decision

MDVE may be called v1 only when **one identified release candidate passes every
gate below**. A release candidate is one Git commit, one versioned npm tarball,
and one recorded SHA-512 integrity value. Checkout-only results, an earlier
tarball, a manual demonstration, or a retry that hides a failure cannot stand in
for evidence from that same candidate.

The gates are categorical, not a score. Product polish cannot offset a durability
failure; broad tests cannot offset an inaccessible critical action; a fast
checkout cannot offset a broken installed package. A failed gate blocks the
`v1.0.0` tag and npm `latest` promotion until a new candidate passes the complete
matrix again. Evidence never carries forward across a changed commit or tarball.
Deadlines, demos, and issue labels are not waivers.

GitHub issue [#6](https://github.com/mustbearnold/MDVE/issues/6) is an exception
only for merging planning pull requests whose Actions job fails before executing
repository steps and whose exact head passes the equivalent local checks. It is
**not** a v1 exception. V1 remains blocked until the trusted-publishing workflow
starts on a GitHub-hosted runner, executes every required step, and passes for the
release commit.

### Gate 1: product and security behavior

The packed candidate must pass the complete critical-journey matrix on Ubuntu
24.04 LTS and the current stable Fedora release at candidate freeze, using the
current stable Chromium and Firefox versions recorded in the evidence bundle:

1. Clean first run, create, open/import, rename, source edit, flowchart structured
   edit, export, archive, restore, restart, and reopen all preserve the expected
   Diagram identity and source. Startup creates at most one starter across
   remounts/retries; Recent, All diagrams, Archived, title/source search, duplicate
   titles, activity ordering, and reversible library lifecycle follow the adopted
   contract. Source-only grammars render and remain editable while every
   structured control and mutation path stays unavailable.
2. Save, conflict, recovery-draft, recovery-point, restore, history-degraded,
   agent-running, stopped, failed, interrupted, and cannot-resume states expose
   the truthful action required by their contracts; no critical outcome exists
   only in terminal output or browser developer tools.
3. A live ChatGPT-authenticated Codex matrix proves app-server initialization and
   version-matched schema compatibility, `account/read`, `model/list`, new and
   resumed threads, persisted streamed progress and outcomes, interruption, an
   unavailable provider thread, and creation of a new Conversation from the
   current durable revision. Multiple Conversations, archive/restore, last-selected
   restoration, revision-gap disclosure, and a read-only cannot-resume transcript
   all preserve identity and evidence. Every Conversation remains immutably bound
   to Codex and its own opaque provider-thread identity.
4. The production server binds only to the configured loopback address, rejects
   unauthenticated API calls and invalid Host or Origin values, exchanges the
   one-use bootstrap secret for the intended HttpOnly SameSite session, and emits
   no bootstrap secret, Codex credential, prompt/source content, or provider
   thread id through logs or diagnostics.
5. Every critical journey passes in automated browser/API coverage and once as a
   release-owner exploratory run from the packed artifact. There are no skipped,
   quarantined, or retry-masked critical tests and no open defect that violates a
   gate in this decision.

Only exact Codex versions exercised by the compatibility matrix may be claimed
as supported. A semver range additionally exercises its oldest and newest
versions and every intermediate version whose generated schema differs. Logged
out, unsupported-version, missing-binary, expired-thread, and disconnected
states fail visibly without reading Codex credentials or private cache files.

### Gate 2: reliability and fidelity

All deterministic unit, integration, fault-injection, contract, and browser
suites must pass ten consecutive times on the release commit without a test
retry. The required behavior inventory is more important than a line-coverage
percentage and includes:

1. Every acknowledged **Saved** revision survives tab, browser, and server
   restart; every latest unacknowledged edit is either represented by a matching
   recovery draft or accompanied by an explicit journaling failure. Injected
   failures cover temporary write, file flush, atomic replace, parent-directory
   flush, metadata/revision commit, draft write/clear, and recovery-point write.
2. Stale tabs, external file changes, delayed requests, Diagram switches,
   concurrent edits, and agent write leases never resolve through silent
   last-write-wins. The losing source remains inspectable, and restore always
   creates a new durable revision without deleting prior recovery evidence.
3. Recovery-ledger tests prove the 30-second inactivity and five-minute sustained
   editing checkpoints; every required pre/post import, restore, agent-turn, and
   Diagram-switch point; origin/checksum metadata; identical-source deduplication;
   retention of every point for 30 days and at least the newest 100; and cleanup
   that never removes the current source. A failed routine history write exposes
   **Saved — history unavailable**, while a missing required pre-change point
   blocks the agent turn, import, or restore.
4. A fixed-seed 1,000-operation soak across edit, save, switch, crash, restart,
   agent stop/failure, archive, and restore records zero lost acknowledged
   revisions, zero false **Saved** states, zero simultaneous write leases for one
   Diagram, and zero unreconciled persisted `running` turns after restart.
5. The flowchart corpus covers supported shapes/arrows, chains, labels, comments,
   subgraphs, directives, reserved ids, opaque statements, imports, undo/redo,
   recovery, and agent changes. Each structured mutation proves its intended
   semantic change and byte preservation outside the changed statement;
   unsupported and invalid grammars prove zero structured source mutation. The
   same release suite's HTTP API and Conversation contracts cover validation,
   conditional writes, authentication, lifecycle transitions, transcript/revision
   persistence, cancellation races, unavailable-thread recovery, and
   provider-binding rejection without live user data or credentials.

Any nondeterministic failure invalidates the ten-run sequence. It must be
explained and fixed before the count restarts; repeatedly running a flaky suite
until green is a failed gate.

### Gate 3: accessibility

Every application-owned full page, responsive variation, and page in each
complete critical process must conform to applicable WCAG 2.2 Level A and AA
criteria. Automated checks are necessary but not sufficient:

1. Automated accessibility scans report zero detected WCAG 2.2 A/AA violations
   across Welcome, Diagram library, source editor, preview, Inspector, History,
   conflict/recovery, Conversation, error/degraded, archive, and install/help
   states in both supported browsers.
2. A criterion-by-criterion manual A/AA matrix records every tested full page,
   state, responsive variation, complete process, browser, viewport, input method,
   assistive technology, tester/date, and the rationale for each not-applicable
   judgment. Every applicable criterion passes.
3. Keyboard-only and Orca use in Firefox complete every critical journey. Focus
   order follows the visual task order; focus is never trapped or lost after
   dialogs, menus, rendering, Diagram switches, or stopped turns; and every
   focusable element has an always-visible focus indicator.
4. Every control has a descriptive accessible name plus correct role, state,
   value, disabled reason, and error relationship. Symbol-only names such as
   `+`, `−`, `↶`, `↷`, `×`, or `↺` are failures even when a mouse tooltip exists.
5. Text and controls retain content and operation at 200% text zoom, 400% browser
   zoom, and a 320 CSS pixel viewport. Two-dimensional scrolling is allowed inside
   the Diagram
   canvas, but the surrounding application, actions, errors, and recovery UI may
   not overlap, disappear, or require two-axis scrolling.

The manual pass additionally verifies landmark/navigation structure, names and
state changes, save/recovery and agent-progress announcements, error movement,
dialog semantics, contrast, text spacing, 24-by-24 CSS-pixel targets or valid
exceptions, single-pointer alternatives to dragging, reduced motion,
high-contrast/forced-colors behavior, and a keyboard-equivalent path for every
pointer-only graph action.

Arbitrary imported Mermaid can contain user-selected text, colors, links, and
structure, so MDVE does not claim that every possible rendered Diagram conforms.
The shipped application, examples, and generated transformations must pass; the
complete Mermaid source remains a keyboard- and screen-reader-accessible
equivalent; and user-authored preview content may not block access to application
chrome or the rest of a complete process. The published conformance statement
names this content boundary and the exact tested technologies and date.

The evidence bundle records the automated rule set, browser/accessibility-tool
versions, tested states, manual checklist, and DOM/accessibility-tree evidence.
Screenshots alone cannot prove names, focus, state, or hit testing.

### Gate 4: performance

Performance is measured from the installed tarball on a declared clean Linux
reference VM with fixed CPU, memory, Node, browser, and Diagram fixtures. Raw
results and the measurement harness ship with the release evidence; medians alone
cannot hide tail latency.

1. Across 20 cold launches, the authenticated loopback UI and API are usable
   within 2 seconds at p75 and 3 seconds at p95, excluding the cost of opening an
   already-running external browser process.
2. Across 20 cold navigations, Largest Contentful Paint is at most 2.5 seconds,
   Cumulative Layout Shift is at most 0.1, and lab Total Blocking Time is at most
   200 milliseconds, each at p75. Scripted critical interactions complete within
   200 milliseconds at p75 and 500 milliseconds at p95; these are lab interaction
   timings, not a field INP result.
3. For the representative technical-flowchart fixtures, edit-to-painted-preview
   latency is at most 200 milliseconds at p75 and 500 milliseconds at p95; a
   200-node/300-edge Diagram opens and settles within 1 second at p95. Final input
   to durable **Saved** is at most 750 milliseconds at p75 and 1.5 seconds at p95;
   Diagram switch, including flush and render, is at most 500 milliseconds at p75
   and 1 second at p95.
4. Submit and Stop actions expose their pending/stopping state within 100
   milliseconds at p75 and 200 milliseconds at p95, excluding provider generation
   time. A local controlled Stop reaches a persisted interrupted terminal state
   and closes the write lease within 2 seconds at p95.
5. The initial application JavaScript chunk is no larger than 500 kB minified.
   Every initial or async chunk over Vite's 500 kB uncompressed advisory identifies
   its dominating dependencies and whether it is deferred. Raising or suppressing
   the warning merely to pass is forbidden, but a deferred Mermaid grammar chunk
   is not independently a release failure when the initial limit and every
   measured journey budget pass.

The Web Vitals numbers are responsiveness and visual-stability anchors, not a
claim of field Core Web Vitals data: the pre-commercial local app has no telemetry
identity and therefore has no representative field population. Bundle size is a
diagnostic guardrail; passing it never substitutes for the user-visible timings.

### Gate 5: installation and release integrity

The exact tarball promoted to `latest` must pass the installation matrix on Node
22 and Node 24 LTS and must remain byte-identical to the recorded candidate:

1. `npm pack --json` matches an exact allowlist containing the executable,
   compiled server, production UI, essential documentation, counsel-approved
   `LICENSE.md`, required third-party notices, and build metadata. It contains no
   `.scratch`, `.agents`, repository workflow, development source/configuration,
   source map, credential, local path, or user data unless individually reviewed
   and explicitly allowlisted.
2. Clean temporary global prefixes install without the repository or development
   dependencies on the declared floor and latest patch of both Node 22 and Node 24
   LTS. `mdve`, `mdve --no-open`, `mdve version`, `mdve doctor`, and redacted
   `mdve doctor --json` work; the package UI/server versions match; and the stable
   origin, bootstrap authentication, create/edit/save/reopen loop, and offline
   non-agent editing pass from the installed artifact. Negative preflight tests
   reject unsupported Node or non-Linux systems before touching user data and give
   one actionable error for a missing/unsupported/logged-out Codex runtime, an
   unwritable data directory, and an occupied stable port without silently moving
   origins.
3. Update from the last `next` candidate, explicit rollback to it, reinstall, and
   uninstall preserve `~/.mdve`, Diagram revisions, recovery drafts/points,
   Conversations, and provider continuity. An older incompatible binary refuses
   writes before migration; any non-backward-readable migration first creates and
   verifies a checksummed recovery snapshot.
4. Production dependencies have zero known high or critical advisories; direct
   and transitive licenses/notices and copyright ownership are reviewed; the
   unscoped npm name is rechecked; and qualified counsel approves the selected
   license text, artifact scope, notices, and commercialization boundary before
   `private: true` is removed or any public publish occurs.
5. GitHub Actions installs from the lockfile, runs every gate applicable in CI,
   builds and inspects the same tarball, and publishes through npm trusted
   publishing with OIDC and no long-lived npm token. Release evidence records the
   workflow run, commit/tag, manifest, SHA-512 integrity, trusted-publisher state,
   and the explicit limitation that private GitHub source cannot produce public
   npm provenance.

Promotion is two-stage: the candidate is first published to `next`, installed by
registry name on the full matrix, and compared with its pre-publish tarball. Only
that unchanged version may receive `latest`; npm versions are never overwritten.

### Release evidence bundle

One versioned evidence bundle must bind every result to the candidate and remain
reachable from the GitHub Release, npm release record, and MDVE release-evidence
index. It contains:

- Git commit, signed tag, package/version, tarball filename, SHA-512 integrity,
  lockfile hash, build/workflow URL, and exact Linux, Node, npm, Codex, browser,
  and accessibility-tool versions;
- raw test and ten-run reliability results, fixture/corpus versions, fault and
  soak seeds, API/browser reports, performance samples, build output, tarball
  manifest, dependency audit, and diagnostic-redaction output;
- the manual product/accessibility checklist with tester and date, live Codex
  compatibility outcomes, legal-approval reference, registry-name check, update,
  rollback, uninstall, offline, and recovery results;
- an explicit list of non-gating observations and known limitations, including
  private-source provenance, without relabelling a failed gate as a limitation;
  and
- a final declaration that every gate passed on the same candidate with no
  hidden rerun, waived blocker, source publication by the release process,
  telemetry, paid entitlement, or claim beyond the exercised support matrix.

### Current readiness finding

The current `2af0745` baseline is **not a v1 candidate**. Local evidence on
2026-07-28 shows 12/12 focused tests, type checking, and a production build pass,
but there is no parser, API, Codex app-server, complete durability/recovery, or
browser release suite. The build's initial JavaScript chunk is 1,090.11 kB
minified (301.08 kB gzip) and Vite reports chunks over 500 kB.

`npm pack --dry-run --json` reports 160 entries and includes `.agents`, `.scratch`,
GitHub workflow, TypeScript server source, and other development material; the
package remains private, has no `bin`, omits the production UI, and starts through
the development-only `tsx`. Several icon-only controls expose symbols rather than
descriptive accessible names. GitHub Actions issue #6 and qualified legal approval
also remain open. Passing today's three local commands is useful development
evidence, not evidence for the contract above.

### Options considered

| Policy | Reliability | Auditability | Cost | Decision |
| --- | --- | --- | --- | --- |
| Best-effort checklist and owner judgement | Low; failures can be traded away | Low | Low | Reject |
| Readiness score or weighted quality threshold | Medium-low; severe failures can average out | Medium | Medium | Reject |
| Absolute source-level checks without an installed candidate | Medium; package and update failures remain invisible | Medium | Medium | Reject |
| Risk-based categorical gates on one immutable candidate | High | High | High | **Choose** |

The chosen policy costs a browser matrix, fault injection, performance harness,
packaged lifecycle environment, live Codex smoke, and disciplined evidence
retention. That is proportionate to a product whose differentiation is trustworthy
local editing and honest agent recovery. It also prevents a test count, Lighthouse
score, screenshot, or successful demo from being mistaken for the durability and
installation promise users actually receive.

The [primary-source research
report](../../../docs/research/2026-07-28-v1-release-gates.md) separates external
standards from MDVE-selected thresholds and records the current official sources.

Confidence: **high (0.94)**. The category boundaries follow every prior v1
decision and the current gaps are directly reproduced. Performance thresholds
remain project-selected budgets that must be proven on the declared reference
environment; field performance is intentionally not claimed without telemetry.

## Comments

- Claimed for a new Wayfinder session on 2026-07-28. GitHub mirror:
  [Define the v1 release gates](https://github.com/mustbearnold/MDVE/issues/12).
