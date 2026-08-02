# MDVE v1 release-gate research

**Research and source-access date:** 2026-07-28
**Ticket:** `.scratch/mdve-v1/issues/05-define-v1-release-gates.md`
**Question:** Which measurable product, reliability, accessibility, performance, and installation checks must pass before MDVE can be called v1?

## Evidence labels

- **[A] Authoritative** — a requirement or behavior stated by the specification, platform, or tool owner.
- **[P] Project-selected** — a measurable MDVE v1 release threshold. It is intentionally stricter or more specific than the source, but is not an external standard.
- **[I] Inference** — an engineering conclusion drawn from authoritative behavior and MDVE's adopted product contract. It still requires MDVE-specific tests.

All external factual claims below link to the current official specification, documentation, or source that owns the behavior. Local findings describe this checkout at the ticket's claimed head and are not claims about an external standard.

## Recommendation

Call a build **MDVE v1** only when one immutable release candidate passes all eight blocking gates below and its evidence is attached to the release record. A local pass, an npm tarball, a successful production build, or a passing accessibility scanner is evidence for one part of the decision; none is a substitute for the complete set.

### Status update — 2026-08-02

The repository is public and exact candidate `240342afb2daf52504949a4e82629516a750a48e` is the immutable release commit used for this record. Its GitHub-hosted CI and CodeQL gates completed successfully ([CI run 30727254570](https://github.com/mustbearnold/MDVE/actions/runs/30727254570), [CodeQL run 30727254569](https://github.com/mustbearnold/MDVE/actions/runs/30727254569)); all 15 exact-head check-runs completed, with only the pull-request-only dependency-review job skipped. This candidate closes both the Firefox startup-reload race by handling an aborted provider request and the stale-background-load race that could overwrite a newly selected Diagram; the release test also asserts that no console or page errors occur. The broader candidate includes the Codex app-server integration, generated protocol artifacts and negative initialization checks, Node 22/24 runtime gates, packaged browser/accessibility checks, browser draft reload/promotion and storage-failure checks, Recent/All/Archived/Trash library lifecycle coverage, idempotent startup, artifact checks, lifecycle checks, reliability soak, release-stability harness, dense-graph performance evidence, Linux process-crash recovery evidence, and a fail-closed release-owner publication guard. This is technical candidate evidence, not a stable-publication decision: the manual WCAG/Orca record, registry install/signature and trusted-publishing evidence, qualified legal approval, and a separately built previous-release rollback remain release gates.

The exact `mdve-1.0.0.tgz` candidate contains 75 files and 1,144,002 bytes and is recorded with SHA-256 `f1f78ac282392a3c826bd6514a164ced7051f21d049f84f4c959b2ebeefbc0c8` and SHA-512 integrity `sha512-jauXHfLtQcFNDU10ly8QXGQxJD2xn+fJkv++7peJzzyi7pNtm/hdqv0Z9Y8qWAwf6yzcm8PhjSwT6Su1KnfEyA==`. The 240342a-bound local release-stability harness completed 10 consecutive runs, 40 suite executions, and 10,000 reliability operations without retry or skip masking; the evidence writer verified that the ledger commit equals the candidate commit. The exact tarball passed the installed 22-test Chromium/Firefox browser matrix, 20 cold and 20 warm performance samples including dense 200-node/300-edge openings, three process-crash recovery points, generated Codex 0.146.0 schema validation, production license verification, and the install lifecycle. The exact-head GitHub-hosted run passed the same release matrix, including Fedora 44, Node 22/24, packaged Chromium/Firefox journeys, process-crash recovery, lifecycle retention, Codex schema, audit, reliability, and CodeQL. The packed launcher also passed `mdve doctor --json` on Node 22.22.2 with authenticated Codex 0.146.0. A subsequent live authenticated app-server run also completed `account/read`, `model/list`, `thread/start`, and a real `turn/completed` in an isolated workspace; the [live Codex record](../release/live-codex-240342a.md) and [registry-name check](../release/registry-name-240342a.md) close those technical subchecks. These are technical and local release-owner evidence; they do not replace the remaining manual accessibility, legal, trusted-publication, or previous-stable rollback records. The raw dense TBT is retained as diagnostic evidence because Mermaid's synchronous layout is intentionally included in the measured render boundary.

Before a tag-triggered publish, the release workflow now requires the protected `npm-release` environment secret `MDVE_RELEASE_OWNER_EVIDENCE`. Its candidate-bound JSON record must contain the manual accessibility matrix, live Codex run, qualified legal approval, registry-name check, separately built previous stable, and lifecycle evidence. The non-sensitive [evidence template](../release-owner-evidence.example.json) matches the validator's schema but is deliberately not valid until every placeholder is replaced with real evidence. The workflow validates that record before `npm publish --tag next` and carries only its redacted gate summary into the release evidence bundle.

| Blocking gate | Required release evidence |
| --- | --- |
| 1. Product contract and regression coverage | Exact-head tests for API, parser/mutator, packaged browser workflows, responsive states, recovery, and agent state; typecheck and production build |
| 2. Durable files and recovery | Fault-injected atomic-write, conflict, restart, draft, history, restore, and interrupted-agent tests |
| 3. Accessibility | WCAG 2.2 AA matrix, zero automatically detected violations in exercised states, and recorded manual keyboard/zoom/screen-reader results |
| 4. Browser and local performance | Raw repeat-run measurements meeting the selected Core Web Vitals-aligned, startup, preview, save, switch, and interruption budgets |
| 5. Supported runtime | Node 22 and 24 LTS matrix, enforced runtime preflight, and an explicit Codex compatibility range |
| 6. Release artifact and install lifecycle | Tarball manifest/hash, clean-prefix install and launch, registry integrity/signature checks, update/rollback/uninstall data-retention tests |
| 7. Codex app-server contract | Generated-schema plus lifecycle tests for initialization, account, models, thread start/resume, streamed turns, interruption, and unavailable threads |
| 8. Independent CI and release record | A GitHub-hosted exact-head workflow with executed steps and a complete, reviewable evidence manifest |

The paragraph below is the 2026-07-28 baseline that motivated the implementation work; it is retained as research history. Current candidate status is recorded in the update above. The release decision still depends on the complete gate matrix, not on the fact that several of the baseline findings are now repaired.

## 1. Product contract and regression gate

### Required checks

**[P]** One clean checkout of the exact release commit must pass, without updating the lockfile:

```text
npm ci
npm test
npm run typecheck
npm run build
```

**[P]** `npm test` must include all of these release-blocking suites:

1. API contract tests for Diagram/Conversation lifecycle, conditional revisions, validation, conflict responses, loopback authentication, and errors.
2. A version-pinned Mermaid corpus proving that supported `flowchart`/`graph` sources parse, render, and survive every structured mutation without changing opaque source; every other grammar remains source-only.
3. Packaged-production browser tests for create/import/edit/save/reload/switch/archive/recover/restore, source and visual edits, new and resumed Conversations, stop/failure/restart, and unavailable-provider-thread recovery.
4. Responsive and input coverage at the supported desktop widths, keyboard-only use, focus and dismissal behavior, pointer hit testing, and text zoom/reflow.
5. Negative-path tests for malformed Mermaid, stale revisions, disk/quota/permission failures, occupied ports, missing or unsupported Node/Codex, logged-out Codex, and unavailable provider threads.

Mermaid's official API distinguishes syntax validation through `mermaid.parse()` from rendering through `mermaid.render()`, so a parser-only pass is not rendering evidence **[A]** ([Mermaid usage and API](https://mermaid.js.org/config/usage.html)). The official flowchart grammar includes substantially more syntax than MDVE's structured model **[A]** ([Mermaid flowchart syntax](https://mermaid.js.org/syntax/flowchart.html)); therefore, the adopted flowchart-only structured boundary requires a preservation corpus rather than a claim that MDVE models all valid Mermaid **[I]**.

### Blocking rule

**[P]** Any failing required scenario, unhandled console/page error, silent fallback, source drift, inaccessible recovery action, or test that passes only against the development server blocks v1. Flaky tests are failures until their cause is fixed or the test is replaced by deterministic evidence; rerunning until green is not release evidence.

## 2. File durability and recovery gate

### What the platform guarantees

- Node warns that promise-based filesystem operations are not synchronized or thread-safe, and concurrent modifications to the same file can corrupt data **[A]** ([Node.js filesystem API](https://nodejs.org/api/fs.html)). This supports MDVE's per-Diagram serialized writer and conditional revision contract **[I]**.
- `FileHandle.sync()` requests that all data for an open descriptor be flushed to the storage device, while the exact implementation remains operating-system and device specific **[A]** ([Node.js `filehandle.sync()`](https://nodejs.org/api/fs.html#filehandlesync)).
- POSIX `rename()` replacement keeps the destination name visible as either the old or new file throughout the operation **[A]** ([POSIX.1-2024 `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)). This supports same-directory temporary-file replacement as the atomic visibility primitive **[I]**; it does not by itself establish power-loss durability.
- On Linux, `fsync()` flushes file data and metadata, but an explicit `fsync()` on the containing directory is also needed to ensure the directory entry reaches disk **[A]** ([Linux `fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html)).
- IndexedDB transactions are atomic; a `strict` durability hint tells the browser it may report commit only after outstanding changes are written to persistent storage, while the specification still calls this a hint that the user agent weighs against platform costs **[A]** ([Indexed Database API 3.0 transaction durability](https://www.w3.org/TR/IndexedDB/#transaction-durability)).

### Required server-side evidence

**[P]** The canonical file, revision record, recovery-point manifest, metadata, and Conversation transcript must use one tested durable-commit primitive: create a unique temporary file in the destination directory, write all bytes, sync and close it, rename it over the destination, sync the parent directory, and acknowledge success only afterward.

**[P]** Deterministic fault injection must fail each boundary—temporary create, partial write, file sync, close, rename, directory sync, manifest update, and cleanup—and prove:

- an acknowledged revision is readable, checksummed, and complete;
- an unacknowledged operation leaves either the preceding complete revision or a recoverable complete successor, never truncated mixed content;
- a failed history/manifest write is reported as degraded durability and blocks agent/restore operations that require a pre-change recovery point;
- abandoned temporary files are either safely removed or ignored and diagnosed on restart; and
- a write is never reported as **Saved** before both its durable file and monotonically increasing revision are committed.

**[P]** Concurrency tests must exercise two writers based on the same revision, edits arriving during an in-flight write, independent Diagrams, an external filesystem change, a Diagram switch, and an agent lease. Exactly one stale writer may commit; the other must receive a conflict while its source remains recoverable. Last-write-wins is a v1 blocker.

**[P]** Linux subprocess tests must kill the MDVE server at controlled points before and after rename, restart it against the same temporary `MDVE_HOME`, and accept only the old or new checksummed revision. This is process-crash evidence, not a claim that CI simulated power removal, faulty drive firmware, every filesystem, or total disk loss **[I]**.

### Required browser and recovery evidence

**[P]** The latest unacknowledged source must be journaled in an IndexedDB read/write transaction requested with `durability: "strict"`; MDVE clears it only after the matching durable revision is acknowledged. Browser tests must cover reload, tab close/reopen, browser-process restart, quota failure, storage denial, stale-draft conflict, and successful draft promotion.

**[P]** History tests must prove every specified checkpoint exists with revision, timestamp, origin, and checksum; restoring creates a new durable revision after checkpointing the previous head; damaged history is detected; the retention rule is deterministic; and update, rollback, or uninstall never changes `~/.mdve`.

**[P]** Every agent completion, failure, interruption, app-server exit, and MDVE restart must reconcile the final on-disk `diagram.mmd`, close the write lease, record an explicit turn outcome, and create the required post-turn recovery point before direct editing resumes.

### Honest boundary

The current `writeAtomic()` sequence writes and syncs a temporary file, renames it, and syncs its parent directory. The unit suite covers every atomic-write fault point, and `npm run test:process-crash` now kills the production server before rename, after canonical-file rename, and after revision-file rename before restarting the same `MDVE_HOME`; the restart accepts only an old or new checksummed revision and removes abandoned temporary files. The packaged browser suite now covers reload, stale-draft promotion, same-revision restoration, storage denial, quota failure, large-text/forced-colors/reduced-motion reflow, and the existing recovery workflow. A complete recovery ledger and manual release-owner record remain separate evidence requirements.

## 3. Accessibility gate

### Authoritative target

WCAG 2.2 Level AA requires every applicable Level A and AA success criterion, full pages including responsive variations, and every page in a complete process to conform **[A]** ([WCAG 2.2 conformance requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs)). Its UI requirements include programmatic name/role/value and programmatically determinable status messages **[A]** ([WCAG 2.2, 4.1.2 and 4.1.3](https://www.w3.org/TR/WCAG22/#compatible)).

No automated scanner can determine WCAG conformance by itself; knowledgeable human evaluation is required **[A]** ([W3C Evaluating Web Accessibility](https://www.w3.org/WAI/test-evaluate/)). Playwright likewise documents that axe integration finds only some common problems and recommends automated, manual, and inclusive user testing together **[A]** ([Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)).

### Project gate

**[P]** MDVE's application-owned UI and shipped examples target WCAG 2.2 AA. Each release candidate must produce all three artifacts below:

1. **Automated state scan:** `@axe-core/playwright` reports zero violations after loading and after opening or triggering every material state: menus, dialogs, inspector, source editor, preview, save/saved/error, conflicts, history/restore, archive, agent streaming/failure/interruption, onboarding, and diagnostics. No broad DOM exclusions or disabled rules are allowed.
2. **Manual WCAG matrix:** a criterion-by-criterion A/AA result names the tested route/state, browser, viewport, input method, assistive technology, tester, date, and issue link for every failure or not-applicable judgment.
3. **Task evidence:** keyboard-only and Orca screen-reader runs on Linux complete create/import, edit, save/reload, switch, recover/restore, start/resume a Conversation, follow streamed status, and interrupt a turn without pointer input.

**[P]** The manual pass must explicitly verify accessible names for every icon-only control; native role/state/value; logical tab and reading order; visible and unobscured focus; no keyboard trap; dialog focus containment and return; status/error announcements without forced focus; 200% text zoom, 400% browser zoom/reflow, and text-spacing overrides; contrast; 24-by-24 CSS-pixel minimum pointer targets or valid exceptions; a single-pointer alternative for any drag gesture; reduced motion; high-contrast/forced-colors use; and operation at each supported responsive width.

The prior baseline finding that icon-only controls exposed symbols rather than descriptive names is repaired in the current candidate: shipped icon controls now carry explicit accessible names, and the exact-head browser suite exercises those controls through axe and keyboard paths. This does not replace the still-required criterion-by-criterion manual WCAG/Orca record or a screen-reader announcement check.

### User-authored diagram boundary

**[I]** Arbitrary imported Mermaid can contain author-selected text, colors, links, and structure that MDVE did not create. A blanket claim that every possible rendered Diagram conforms to WCAG 2.2 AA would therefore be unsupported. V1 must:

- provide the complete Mermaid source as a keyboard- and screen-reader-accessible equivalent to the visual preview;
- prevent the preview from interfering with access to the rest of the app;
- make all MDVE-generated examples and generated transformations pass the gate; and
- scope any published conformance statement to the tested application-owned pages, states, technologies, and content, including its date as WCAG requires.

User-content limitations must be stated; they cannot be used to exclude application chrome or complete workflows from testing.

## 4. Browser, local-runtime, and bundle performance gate

### Authoritative browser signals

Google's current Core Web Vitals targets are LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1, assessed at the 75th percentile of page visits and segmented by mobile and desktop **[A]** ([Web Vitals](https://web.dev/articles/vitals)). Lighthouse cannot measure INP without real user interaction; it uses Total Blocking Time as a lab proxy, and lab results do not replace field measurement **[A]** ([Web Vitals, lab measurement](https://web.dev/articles/vitals#lab_tools_to_measure_core_web_vitals)).

### Measurement protocol

**[P]** Store raw results, not only a summary score. Record release commit, production package version, browser and Node versions, CPU/RAM/storage, OS, viewport, throttling, Diagram fixture, run count, and measurement code. Use a quiet declared Linux reference machine, a production package, clean browser profiles, and at least 20 cold and 20 warm samples; publish p50, p75, and p95. Provider network generation time is reported separately from MDVE overhead.

**[P]** Pre-release lab gates are:

| Signal | Threshold | Boundary |
| --- | --- | --- |
| LCP | p75 <= 2.5 s | Initial packaged-app navigation on the reference Linux desktop |
| CLS | p75 <= 0.1 | Initial load plus the exercised primary workflow |
| TBT | p75 <= 200 ms | Repeatable Lighthouse lab proxy; never reported as INP |
| Dense Diagram open | p95 <= 1.0 s | All 200 nodes visibly rendered from a 200-node/300-edge production-package fixture; 20 cold and 20 warm openings |
| Scripted interaction latency | p75 <= 200 ms and p95 <= 500 ms | Actual editor, preview, library, history, and Conversation interactions; reported as lab interaction latency, not field INP |
| Cold CLI-to-ready | p75 <= 2.0 s and p95 <= 3.0 s | `mdve` process start until authenticated loopback UI and API are usable, excluding opening an already-running browser process |
| Edit-to-preview | p75 <= 200 ms and p95 <= 500 ms | Final input event until the representative 100-node flowchart is visibly updated |
| Edit-to-**Saved** | p75 <= 750 ms and p95 <= 1.5 s | Final input event through debounce, atomic file and directory sync, and durable revision acknowledgement |
| Diagram switch | p75 <= 500 ms and p95 <= 1.0 s | Flush current edit, load target source, and render target preview |
| Agent UI acknowledgement | p75 <= 100 ms and p95 <= 200 ms | Submit or Stop activation until pending/stopping state is visible; excludes provider completion |
| Interrupt terminal state | p95 <= 2.0 s | Stop activation until app-server reports `interrupted` and MDVE closes the write lease on a local test turn |

These numeric local-app budgets are MDVE product choices **[P]**, not W3C, Google, Vite, Node, or OpenAI requirements. They are deliberately measured with durable syncing enabled; disabling safety behavior to hit a latency target is not a valid pass.

The dense-render budget is a separate product boundary from the ordinary initial-page TBT proxy. Dense raw TBT remains in the release record and is not silently relabeled as INP; the blocking dense signal starts after the durable revision and saved state are loaded, then measures until all 200 nodes are visibly rendered. Page startup, navigation, and durable-source loading remain covered by the cold and warm usability metrics.

If MDVE later collects privacy-respecting real-user measurements, the formal Core Web Vitals judgment uses p75 field LCP/INP/CLS rather than the synthetic values above **[A]**. Until then, release notes must say “lab-tested against Core Web Vitals-aligned thresholds,” not “passes Core Web Vitals” **[I]**.

### Production bundle guidance

Vite's `build.chunkSizeWarningLimit` defaults to 500 kB and compares uncompressed chunk size because JavaScript size is related to execution time **[A]** ([Vite build options](https://vite.dev/config/build-options.html#build-chunksizewarninglimit)). Vite defines this as a warning threshold, not a user-experience or Core Web Vitals conformance rule **[A]**.

**[P]** Each release stores the production manifest plus raw and gzip size of every initial and async asset, identifies which dependencies dominate any chunk over 500 kB, and records whether the chunk is initial-route or deferred. Raising the warning limit merely to hide the current message is a gate failure.

**[I]** Vite does not make a chunk over 500 kB an automatic release failure, and a chunk under 500 kB is not a performance pass. MDVE separately selects a stricter project gate: the initial application JavaScript chunk must be at most 500 kB minified. A deferred Mermaid grammar chunk above the advisory may ship only when the measured gates pass and the release record explains its dependency makeup and why splitting or further lazy-loading would not improve an exercised workflow. Conversely, a smaller bundle that misses LCP, interaction, or startup budgets still fails. Bundle deltas remain diagnostic evidence; the initial-cap decision and measured user outcomes are the blocking thresholds.

## 5. Node support gate

Node states that production applications should use only Active LTS or Maintenance LTS releases **[A]** ([Node.js releases](https://nodejs.org/en/about/previous-releases)). On 2026-07-28, Node 24 is Active LTS through 2026-10-20, Node 22 is Maintenance LTS through 2027-04-30, Node 20 is end-of-life, and Node 26 is Current rather than LTS **[A]** ([Node.js Release Working Group schedule](https://github.com/nodejs/Release#release-schedule)). Node 22.11.0 and Node 24.11.0 are the first releases in those lines explicitly marked LTS **[A]** ([Node 22.11.0](https://nodejs.org/en/blog/release/v22.11.0), [Node 24.11.0](https://nodejs.org/en/blog/release/v24.11.0)).

**[P]** For the 2026 v1 release:

- declare `engines.node` as `^22.11.0 || ^24.11.0`, not `>=20`;
- test the declared floor and latest available patch of both supported lines on Linux;
- build and publish with the latest patched Node 24 LTS and a pinned npm CLI;
- make the `mdve` launcher reject unsupported majors before touching `~/.mdve`, with the detected version and exact supported range; and
- re-evaluate the matrix for every stable MDVE release and before either Node line leaves LTS.

npm documents that `engines` is normally advisory unless the installer enables `engine-strict` **[A]** ([npm `package.json` engines](https://docs.npmjs.com/cli/configuring-npm/package-json/#engines)). Therefore, package metadata alone is not an enforced runtime gate; the launcher preflight and runtime matrix are both required **[I]**.

The current `>=20` declaration admits EOL Node 20, unsupported odd majors, and untested future majors, while `.github/workflows/ci.yml` selects Node 20. Both must change before v1.

## 6. npm artifact, publishing, and install gate

### Artifact contents and integrity

npm's `files` field controls the package allowlist, while `package.json`, README, LICENSE, and files named by `bin` or `main` have special inclusion behavior **[A]**. `npm pack --dry-run` exposes what publication would include **[A]** ([npm publish files](https://docs.npmjs.com/cli/commands/npm-publish#files-included-in-package), [npm pack](https://docs.npmjs.com/cli/commands/npm-pack)). npm refuses publication when `private` is `true`, and a global install exposes executables through the `bin` mapping **[A]** ([npm `package.json`](https://docs.npmjs.com/cli/configuring-npm/package-json/)).

**[P]** The release candidate must:

1. compile the server and UI, then run `npm pack --json` and `npm publish --dry-run` from a clean checkout;
2. match an explicit file allowlist containing only the launcher, compiled server, production UI/assets, package metadata, README, notices, and counsel-approved license;
3. contain no TypeScript source, tests, `.scratch`, private docs, credentials, home-directory paths, development source maps, or unreviewed embedded source text;
4. record the tarball filename, byte count, full file manifest, SHA-256 release checksum, and npm-generated SHA-512 integrity value; and
5. install that exact tarball into clean temporary global prefixes under every supported Node line and execute `mdve version`, launch, health/API/browser smoke, and shutdown.

npm submits SHA-1 and SHA-512 integrity values when publishing and subsequent installs use the strongest supported algorithm to verify downloads **[A]** ([npm publish integrity](https://docs.npmjs.com/cli/commands/npm-publish#description)). Registry signatures and available provenance attestations can be checked with `npm audit signatures` **[A]** ([npm registry signature verification](https://docs.npmjs.com/verifying-registry-signatures/)).

**[P]** After registry publication, a fresh temporary project must install `mdve@<exact-version>` from `registry.npmjs.org`, run `npm audit signatures`, compare `npm view mdve@<version> dist.integrity dist.shasum` with the tested tarball, repeat the executable/API/browser smoke, and prove that the installed UI/server/package versions agree. A local tarball smoke is not registry-install evidence.

### Trusted publication and private-source provenance

npm trusted publishing exchanges GitHub Actions OIDC identity for short-lived publishing credentials and supports GitHub-hosted runners; npm recommends it over long-lived tokens **[A]** ([npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)). GitHub OIDC requires `id-token: write` for the publishing job **[A]** ([GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc#workflow-permissions-for-the-requesting-the-oidc-token)). npm also requires the package `repository.url` to match the configured GitHub repository exactly **[A]**.

Trusted publishing from a private GitHub repository is supported, but npm does not generate public provenance for a package built from private source, even when the package is public **[A]** ([npm trusted publishing, automatic provenance](https://docs.npmjs.com/trusted-publishers/#automatic-provenance-generation)). Therefore MDVE's release record must say **“trusted publisher: yes; public source provenance: unavailable”** rather than displaying or implying an npm provenance claim **[P]**. The manifest, checksums, registry integrity, signatures, workflow identity, and private commit are valuable evidence, but they are not equivalent to public source-to-package provenance **[I]**.

**[P]** Publish through a dedicated tag-triggered GitHub Actions workflow from the exact reviewed commit, with read-only contents permission plus job-scoped `id-token: write`, a protected release environment where available, no long-lived npm publish token, and no dependency cache in the release job. Publish first with a non-`latest` prerelease tag, smoke the immutable registry version, then move `latest` to that same tested version. npm documents that unqualified publish defaults to `latest` and that dist-tags can label an already published exact version **[A]** ([npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)).

### Lifecycle safety

**[P]** On a copied real-format `MDVE_HOME`, automated black-box tests must cover fresh install, first run, same-version reinstall, upgrade from the previous supported stable, version-pinned rollback, and global uninstall. Every operation must retain Diagrams, revisions, recovery drafts, history, Conversations, provider identities, and settings. A newer incompatible data format must fail read-only with a version message; it must not attempt a destructive downgrade.

**[P]** The shipped production dependency graph must have no unaccepted high or critical registry advisories. `npm audit --omit=dev --audit-level=high` is one input; every exception needs an owner, exploitability analysis for MDVE's loopback threat model, expiry, and linked remediation. npm defines the threshold as the minimum severity that makes the command exit nonzero **[A]** ([npm audit](https://docs.npmjs.com/cli/commands/npm-audit)).

## 7. Codex app-server compatibility gate

### Official stable surface

OpenAI documents `codex app-server` as the rich-client integration for authentication, history, approvals, and streamed agent events **[A]** ([Codex App Server](https://learn.chatgpt.com/docs/app-server.md)). The default stdio transport is newline-delimited JSON; WebSocket transport is experimental and unsupported **[A]**. MDVE should therefore ship stdio only **[I]**.

The CLI can generate TypeScript and JSON Schema artifacts that are specific to the exact Codex version that generated them **[A]**. Clients initialize once per transport connection, send `initialized`, and receive errors for pre-initialization or repeated initialization **[A]**. Omitting `capabilities.experimentalApi` keeps the client on the documented stable surface **[A]**.

The same official lifecycle exposes:

- `account/read` and `account/updated` for current authentication/account state;
- `model/list` for picker-visible entitled models and capabilities;
- `thread/start`, `thread/read`, and `thread/resume` for new, inspect-only, and continued threads;
- `turn/start`, item/delta notifications, and `turn/completed` with `completed`, `interrupted`, or `failed` status; and
- `turn/interrupt`, which succeeds with `{}` and ends the turn with `status: "interrupted"` **[A]** ([Codex App Server](https://learn.chatgpt.com/docs/app-server.md)).

### Compatibility lifecycle

**[P]** MDVE must declare a tested minimum and maximum Codex CLI version range in diagnostics and release evidence. For each stable release, contract tests run against the minimum supported version and the newest current stable Codex version available on the release date. The adapter uses generated schemas from each runtime, fails before opening a Diagram when the installed version is outside the range, and tolerates additive unknown notifications/fields without inventing success.

**[P]** A Codex update that breaks schema generation or any lifecycle fixture blocks widening the supported range; it does not justify falling back to `auth.json`, `models_cache.json`, regex-parsed config, hard-coded model IDs, or `codex exec` event guesses. Stable API means “no experimental capability requested,” not “versionless” **[I]**.

### Required contract tests

| Contract | Blocking evidence |
| --- | --- |
| Schema | Generate TS and JSON Schema from each supported Codex runtime; validate all recorded request/response/notification fixtures; fail on missing required fields or an unhandled terminal status. |
| Initialization | One `initialize` + `initialized` handshake succeeds; a request before initialization and a second initialization produce the documented errors; MDVE never opts into `experimentalApi`. |
| Account | `account/read` detects a ChatGPT-managed signed-in account without reading credential files; logged-out, account update, expired/refresh failure, and process restart produce actionable states without losing Diagram access. |
| Models | `model/list` populates only returned picker-visible models and supported effort options; removed, hidden, empty-catalog, and rejected selections are handled without hard-coded fallback claims. |
| New thread | `thread/start` uses the Diagram workspace as `cwd`, the approved workspace-write sandbox, and a newly persisted provider-thread identity bound to one MDVE Conversation. |
| Resume | After MDVE and app-server restart, `thread/read`/`thread/resume` plus `turn/start` append to the same Conversation; transcript and starting durable revision remain correct. |
| Stream persistence | `turn/started`, item start/completion/deltas, warnings/tools, and `turn/completed` survive client/server restart without duplicate or silently dropped terminal records. Unknown notifications are retained as diagnosable events, not treated as completion. |
| Interruption | Stop sends `turn/interrupt`; the terminal event is `interrupted`; the final file is reconciled; the turn and ending revision are persisted; the agent lease closes exactly once. |
| Failure/crash | Failed terminal status, app-server EOF, malformed message, and forced process exit preserve the partial trace, reconcile the file, mark the turn failed/interrupted as appropriate, and permit explicit recovery. |
| Unavailable thread | A missing/corrupt/incompatible provider thread never rewrites or discards the old provider identity. MDVE preserves its transcript, explains that native resume is unavailable, and offers a **new Conversation** from the current durable Diagram revision. |
| Immutable provider binding | Every Conversation has one provider and at most one opaque provider-thread identity. No test or migration can silently substitute another provider/thread under it. |

Unavailable-thread recovery and immutable provider binding are MDVE domain requirements **[P]**, not behaviors OpenAI promises. They are the safe product response to a failed provider operation **[I]**.

The current `server/src/providers/codex.ts` now uses the app-server stdio adapter, performs version-gated initialization, discovers account/model state through app-server requests, and interrupts turns through `turn/interrupt`. The remaining release evidence is generated-schema validation against the exact supported runtime, initialization-negative-path coverage, and a release-owner run with a real authenticated Codex installation; the adapter migration alone is not evidence for those gates.

## 8. GitHub Actions and release-evidence gate

GitHub required status checks are meant to show that commits meet repository conditions, and protected branches can require them before merge **[A]** ([GitHub status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-commits/about-status-checks), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)). GitHub's run logs expose each job and step status **[A]** ([GitHub workflow run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)). A workflow conclusion with zero executed validation steps therefore supplies no test, typecheck, build, browser, or package evidence **[I]**.

### Exact-head GitHub CI

**[P]** The exact release-candidate head on `master` must complete on a GitHub-hosted runner with actual logs for:

- locked install, unit/integration tests, typecheck, and production build on Node 22 and 24 LTS;
- server fault-injection and Codex schema/contract tests;
- packaged-production browser, accessibility, and performance jobs with their reports uploaded; and
- tarball manifest, clean-prefix install, launch, and data-lifecycle tests.

The `validate` check should be required from GitHub Actions and branch protections should require an up-to-date head. Independent standards and spec/scope/evidence reviews must resolve every release-blocking finding before the release commit is tagged **[P]**. For this repository's direct-to-`master` delivery model, the exact pushed commit and its GitHub checks are the release record; a pull request is not a required delivery artifact.

### Issue #6 historical exception boundary

GitHub issue [Restore GitHub Actions runner availability](https://github.com/mustbearnold/MDVE/issues/6) recorded private-repository runs that executed zero steps because of an account billing/spending-limit block. That issue is now closed, the repository is public, and exact-head GitHub-hosted runs execute the release jobs. GitHub documents that private-repository hosted-runner usage is quota/billing controlled **[A]** ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

**[P]** If the same external block recurs:

- an individual documentation/decision PR may merge only under an explicit exception comment containing the exact head SHA, exact local commands, outputs/test counts, independent review results, zero-step run URL, GitHub annotation, and issue #6 link;
- the record must say **“CI unavailable; zero workflow steps executed”**, never “CI passed”; and
- stable publication remains blocked until the remote release matrix and GitHub-hosted OIDC trusted publication are actually observed for the candidate; the historical exception never waives those gates.

Local validation is useful exact-head evidence. It cannot establish a GitHub-hosted matrix, required-check success, or trusted-publisher identity **[I]**.

### Immutable release record

**[P]** The v1 release record must contain:

1. Git commit and tag, clean-tree assertion, package version, lockfile hash, and successful GitHub workflow/run/job URLs.
2. Exact Node, npm, Codex, browser, OS, and dependency versions plus every test command and count.
3. Accessibility matrix, raw performance results, bundle manifest, tarball manifest/hash/integrity, registry signature output, and the private-source provenance limitation.
4. Clean install/launch, update, rollback, uninstall/data-retention, Codex lifecycle, and recovery evidence.
5. Every accepted non-blocking advisory with owner, rationale, expiry, and follow-up; the record contains no open blocker.

## Decision boundary

The external sources establish WCAG conformance rules, Core Web Vitals definitions, Vite's warning semantics, Node's support lifecycle, npm packaging/integrity/trusted-publishing behavior, filesystem primitives, IndexedDB transaction semantics, GitHub check evidence, and Codex app-server methods **[A]**.

They do **not** choose MDVE's local startup/save/interaction budgets, supported Node range, test matrix, recovery UX, CI exception, or release-evidence format. Those are project decisions **[P]**, selected to make the adopted v1 promise measurable. Whether MDVE meets them is an implementation and test result, not something this research establishes.

## Primary-source register

All sources were accessed on **2026-07-28**.

| Area | Official primary source |
| --- | --- |
| Accessibility standard | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| Accessibility evaluation | [W3C Evaluating Web Accessibility](https://www.w3.org/WAI/test-evaluate/), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) |
| Browser performance | [Google Web Vitals](https://web.dev/articles/vitals) |
| Vite chunks | [Vite build options](https://vite.dev/config/build-options.html#build-chunksizewarninglimit) |
| Node support | [Node.js releases](https://nodejs.org/en/about/previous-releases), [Node.js Release schedule](https://github.com/nodejs/Release#release-schedule), [Node 22.11.0 LTS](https://nodejs.org/en/blog/release/v22.11.0), [Node 24.11.0 LTS](https://nodejs.org/en/blog/release/v24.11.0) |
| npm package/release | [npm package.json](https://docs.npmjs.com/cli/configuring-npm/package-json/), [npm pack](https://docs.npmjs.com/cli/commands/npm-pack), [npm publish](https://docs.npmjs.com/cli/commands/npm-publish), [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/) |
| npm integrity/security | [npm registry signatures](https://docs.npmjs.com/verifying-registry-signatures/), [npm audit](https://docs.npmjs.com/cli/commands/npm-audit), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) |
| CI identity/evidence | [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc), [status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-commits/about-status-checks), [workflow logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Filesystem durability | [Node.js filesystem API](https://nodejs.org/api/fs.html), [POSIX.1-2024 rename](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html), [Linux fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) |
| Browser draft durability | [W3C Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/) |
| Codex integration | [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server.md), [OpenAI Codex app-server source](https://github.com/openai/codex/tree/main/codex-rs/app-server) |
| Mermaid parser/render boundary | [Mermaid usage/API](https://mermaid.js.org/config/usage.html), [Mermaid flowchart syntax](https://mermaid.js.org/syntax/flowchart.html) |
