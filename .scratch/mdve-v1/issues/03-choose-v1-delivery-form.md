# Choose the v1 delivery form

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

Should v1 ship as an installable Linux desktop application, a polished local web application launched from the CLI, or both through one supported release path?

## Evidence to use

- The README calls MDVE a local Linux app, but current setup requires Node, npm, Codex CLI, two development processes, and a browser URL.
- Local filesystem access and subscription-authenticated Codex are core product advantages.
- Packaging affects onboarding, updates, diagnostics, permissions, and the durability contract.

## Comments

## Answer

### Decision

MDVE v1 ships as a **polished local web application launched by an `mdve`
CLI**, with no separately supported desktop wrapper.

The supported runtime shape is one local process that binds only to loopback,
serves a version-matched production UI and API from one stable origin, opens the
user's default browser, and owns startup, prerequisite checks, diagnostics, and
shutdown. The user must not clone the repository, run two development
processes, or manually discover a port. The exact installation and update
artifact is a separate distribution decision; every supported artifact must
produce the same `mdve` command and runtime behavior.

This is a local application, not a hosted website. `diagram.mmd`, recovery
material, Codex credentials, and Codex execution remain on the user's machine.
The release path must preserve the durability contract by keeping the browser
origin stable across ordinary restarts; it may not silently fall back to a new
port and strand recovery drafts. Because the loopback service can read local
diagrams and launch Codex, v1 also requires origin validation and local request
authentication rather than treating `127.0.0.1` as an authentication boundary.
The precise security checks belong in **Define the v1 release gates**.

The CLI UX contract is:

- `mdve` starts the application and opens it;
- `mdve --no-open` supports terminal-managed and automated use;
- startup failures name the occupied port, missing Codex binary, unsupported
  runtime, or unreadable data directory and provide one corrective action;
- the terminal exposes the stable local URL and a diagnostics path without
  printing credentials;
- stopping the launcher shuts down the local service without deleting sessions
  or recovery state.

### Options considered

| Option | Correctness and durability | Architecture and maintenance | Target-user UX | Operability and QA | Decision |
| --- | --- | --- | --- | --- | --- |
| Installable Linux desktop application | Medium | Medium-low | High | Medium-low | Defer |
| Local web application launched by CLI | High | High | High | High | Choose |
| Desktop and browser modes from one release | Medium-high | Low | Medium-high | Low | Reject for v1 |

The desktop option can hide the terminal and add native menus, file dialogs,
task-switcher presence, and tighter window lifecycle. It does not remove MDVE's
host-side responsibilities: a process must still access `~/.mdve`, inspect the
Codex installation and model cache, spawn the subscription-authenticated Codex
CLI, watch files, and expose recovery state. Electron or a system-WebView shell
would therefore wrap the existing local server/UI topology while adding Linux
packaging, WebView/runtime variation, GUI-environment `PATH` handling, update
behavior, permissions, and another crash/restore matrix.

Supporting both forms would preserve future flexibility but turn every
durability, accessibility, agent-lifecycle, and release check into a two-shell
matrix before either form has proved repeated use. Keeping the UI server-based
and shell-agnostic preserves the option to add a desktop wrapper later without
making it a v1 promise.

### Evidence and trade-offs

- The current production topology already works as one origin: `npm run build`
  succeeds, the local server serves the built UI, and the live production API
  reports the installed Codex CLI and subscription-backed models.
- The primary user is a Linux software engineer or technical founder who already
  uses Codex. A one-command CLI launch is native to that workflow; requiring a
  repository checkout, `npm install`, and two development processes is not.
- The durability contract depends on both browser-journaled recovery drafts and
  server-side durable revisions. A stable local browser origin fits that split;
  arbitrary port selection would violate it.
- The existing application has no desktop runtime, packaging configuration,
  native bridge, updater, or desktop-specific tests. Adding those surfaces does
  not improve the winning job of moving among Codex, visual structure, and
  Mermaid source.

The chosen form retains browser chrome and a launcher process, and it defers
native file associations, desktop menus, and an app-store-style install. Those
costs are acceptable for the chosen technical user. A desktop shell should be
reconsidered only after usage evidence identifies a native-only capability or
onboarding failure large enough to justify its permanent release matrix.

Confidence: **high (0.93)**. The current architecture, target user, and
durability contract all favor the local-web form. The remaining uncertainty is
how to package and distribute the launcher, now isolated in **Choose the v1
installation, update, and adoption path**.
