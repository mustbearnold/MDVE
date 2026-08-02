# MDVE — Mermaid Diagram Visual Editor

[![CI](https://github.com/mustbearnold/MDVE/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/mustbearnold/MDVE/actions/workflows/ci.yml)

MDVE is a local Linux workbench for Mermaid diagrams. Edit the source, inspect
the rendered graph, make safe structured flowchart changes, and ask Codex to
transform the same durable diagram.

V1 is Codex-only and runs against the documented Codex app-server interface.
MDVE does not read Codex credential files, model caches, or private config; the
installed `codex` runtime owns authentication and model entitlements.

## Install

V1 targets Node 22.11+ or Node 24.11+ on Linux and requires a supported Codex
CLI (`>=0.146.0 <0.147.0`) already installed and authenticated:

```bash
codex login
npm install --global mdve@1.0.0
mdve
```

The launcher binds to `127.0.0.1`, creates a one-use bootstrap URL, and opens
the local workbench. For a terminal-only launch or a remote-control workflow:

```bash
mdve --no-open
mdve version
mdve doctor --json
```

Package install, update, rollback, and uninstall never delete or rewrite
`~/.mdve`. Diagram source, revisions, recovery points, Conversations, and
provider continuity remain in that directory.

For repository development:

```bash
npm ci
npm run dev
```

The development server is at `http://127.0.0.1:8787`; Vite serves the UI and
proxies API requests to the server. The production-equivalent local build is:

```bash
npm run build
npm start
```

The same build can run in an installable Electron desktop shell. During
development, use `npm run desktop:dev`; to create the local Linux artifact,
run `npm run desktop:build`. The AppImage is written to `release/desktop/` and uses the
same authenticated loopback server, `~/.mdve` data directory, and Mermaid/UI
code as the CLI/browser path.

On a desktop layout, drag the Preview canvas to pan, drag a rendered node or
edge label to reposition it, and click a rendered node to edit its label inline.
Node and edge-label positions are saved as Mermaid-safe `%% mdve:` comments, so
they survive reloads, undo/history, export, and agent turns; Reset saved node
positions removes that presentation metadata. Right-click blank preview space
to add a node at that location, or right-click a node and choose Start link,
then select its target. The close/open controls hide or restore the Source and
right panels, and either vertical divider resizes the workbench. Dividers also
support keyboard arrow resizing when focused.

## The workbench

- Source is CodeMirror over the canonical Mermaid text.
- Preview renders the same text; nodes and links can be selected, edited, linked,
  zoomed, panned, and repositioned with durable layout state.
- Inspector provides byte-preserving structured edits for `flowchart` and `graph` diagrams.
- Agent runs Codex in the Diagram workspace and streams progress into a durable Conversation.
- History lists immutable, checksummed recovery points, compares a point with
  the current revision, and restores a point as a new revision.

Other Mermaid grammars remain renderable and source-editable, but structured
visual mutation is intentionally unavailable when MDVE cannot prove that it is
safe. Mermaid remains the source of truth; there is no second canvas model.

## Durability and continuity

Each Diagram lives under `~/.mdve/sessions/<id>/`:

```text
diagram.mmd                 canonical source
revision.json               monotonic revision and checksum
history/                    immutable recovery files and manifest
conversations/              durable transcripts and provider binding
turn.json                   persisted agent lifecycle and trace
AGENTS.md                   workspace instructions for Codex
session.json                Diagram identity, activity, and lifecycle state
```

An acknowledged `Saved` revision is written through an atomic replacement and
parent-directory sync. Unacknowledged browser edits are journaled as a recovery
draft. Stale saves receive a conflict instead of silently overwriting newer
source. Agent turns hold an exclusive write lease; stopping, failure, or a
restart becomes an explicit persisted outcome.

Diagrams have one source/history timeline and multiple Conversations. A new
Conversation starts from the current acknowledged revision without erasing an
older transcript. Restoring a Diagram never rewinds a Conversation. Archive is
reversible and does not delete source, history, or Conversations.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MDVE_HOME` | `~/.mdve` | Durable Diagram data directory |
| `MDVE_PORT` | `8787` | Loopback server port |
| `MDVE_HOST` | `127.0.0.1` | Bind address; the launcher keeps this loopback-only |
| `MDVE_CODEX_BIN` | `codex` | Codex executable to run |
| `MDVE_WEB_DIST` | packaged `dist/web` | Production UI directory |

The development-only `PORT` and `HOST` aliases are also accepted by the server.

## Development status

The package baseline remains version `1.0.0`; work continues iteratively on
`master` toward the v2 workbench. This repository state is not an official npm
or GitHub publication. The release-gate harness remains available for a future
public distribution, but publication-only owner, legal, registry, and
trusted-publishing gates do not block normal development.

## Scope

MDVE is a local Linux application for individual technical users who already
use Mermaid and Codex. Hosted sync, accounts, real-time collaboration, a fully
free-form canvas, mobile editing, and additional agent providers remain outside
the current workbench boundary.
