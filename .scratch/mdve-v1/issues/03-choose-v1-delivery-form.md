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

## Answer

### Decision

MDVE v1 ships as a **polished local web application launched by an `mdve`
CLI**, plus an Electron desktop shell over the same runtime for users who want
a native window. The shell is a second delivery surface, not a second backend
or diagram model.

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

The desktop UX contract is:

- the Electron main process starts the same authenticated loopback server and
  opens the same production workbench in a native window;
- the shell uses the same `~/.mdve` data directory and server/API contract as
  the CLI/browser path;
- the packaged AppImage passes a launch smoke test that reaches the workbench
  and exercises a preview context-menu action.

### Options considered

| Option | Correctness and durability | Architecture and maintenance | Target-user UX | Operability and QA | Decision |
| --- | --- | --- | --- | --- | --- |
| Installable Linux desktop application | High | Medium | High | Medium | Add as Electron shell |
| Local web application launched by CLI | High | High | High | High | Choose |
| Desktop and browser modes from one release | High | Medium | High | Medium | Choose, sharing one runtime |

The desktop option can hide the terminal and add native window presence and a
tighter window lifecycle. It does not remove MDVE's host-side responsibilities:
a process must still access `~/.mdve`, inspect the Codex installation and model
cache, spawn the subscription-authenticated Codex CLI, watch files, and expose
recovery state. Electron wraps the existing local server/UI topology while
adding Linux packaging, GUI-environment `PATH` handling, update behavior,
permissions, and another crash/restore matrix. The shared runtime and a
packaged-shell smoke test keep that matrix bounded.

Supporting both forms still creates a two-shell matrix for durability,
accessibility, agent lifecycle, and release checks. Keeping one UI/server
implementation and adding a packaged-shell smoke test bounds that matrix while
preserving the browser and CLI workflows.

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
- The existing application now has a desktop runtime, packaging configuration,
  and a desktop-specific launch test. The shell improves the winning job by
  keeping the workbench in a task-switchable native window while reusing the
  same source, history, and agent behavior.

The chosen forms retain a browser path and a launcher process while deferring
native file associations, desktop menus, and an app-store-style updater. Those
costs are acceptable for the chosen technical user. A future native backend or
updater should be reconsidered only after usage evidence identifies a capability
that the shared Electron shell cannot provide.

Confidence: **high (0.89)**. The current architecture and durability contract
favor one canonical loopback runtime; the new desktop shell adds a useful
native window without forking that runtime. The AppImage remains an iterative
local artifact rather than an official publication.

## Comments
