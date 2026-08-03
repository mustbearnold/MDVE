# MDVE — Mermaid Diagram Visual Editor

[![CI](https://github.com/mustbearnold/MDVE/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/mustbearnold/MDVE/actions/workflows/ci.yml)

MDVE is a local Linux workbench for Mermaid diagrams. Edit the source, inspect
the rendered graph, make safe structured flowchart changes, and ask Codex to
transform the same durable diagram.

The current development label is MDVE v3.0.0 (2026-08-03). It builds on the v1
durability contract and the v2 single-diagram workbench while remaining an
iterative development build, not an official release.
MDVE supports Codex and a local BYOK OpenAI-compatible provider. Codex runs
against the documented Codex app-server interface.
MDVE does not read Codex credential files, model caches, or private config; the
installed `codex` runtime owns authentication and model entitlements.

## Install

V1 targets Node 22.11+ or Node 24.11+ on Linux and requires a supported Codex
CLI (`>=0.146.0 <0.147.0`) already installed and authenticated:

```bash
codex login
npm install --global mdve@3.0.0
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
Shift-click nodes to build a multi-selection, drag the selection as a group, and
use Inspector to align or distribute it as one named edit transaction.
Focused nodes also support arrow-key nudging (Shift moves by a larger step), so
every canvas edit has a keyboard path as well as a pointer path.
Node and edge-label positions are saved as Mermaid-safe `%% mdve:` comments, so
they survive reloads, undo/history, export, and agent turns; Reset saved node
positions removes that presentation metadata. Right-click blank preview space
to add a node at that location, or right-click a node and choose Start link,
then select its target. The close/open controls hide or restore the Source and
right panels, and either vertical divider resizes the workbench. Dividers also
support keyboard arrow resizing when focused.

## AI connections and the paid path

The local editor is free without an account. Codex remains bring-your-own
through the installed Codex runtime. Agent settings also include a BYOK
OpenAI-compatible provider for OpenAI, OpenRouter, Ollama, LM Studio, and
similar endpoints. Configure it from Agent settings; the key is written only
to `~/.mdve/provider-openai-compatible.json` with restrictive permissions.

MDVE Pro is the first commercial path: a recommended $49 one-time license for
the current major version, with clean desktop Presentation mode as its first
paid capability. The checkout is intentionally not hard-coded into a
development build. Connect a merchant-of-record store before selling by
setting `MDVE_GUMROAD_PRODUCT_ID` and `MDVE_PRO_CHECKOUT_URL` in the environment
that launches MDVE. The app verifies a purchased key server-side, never sends
it to an MDVE service, and keeps a 30-day offline grace period.

The future recurring Cloud tier is deferred until users demonstrate demand for
encrypted sync, sharing, collaboration, or hosted AI credits. That avoids
turning the free local editor into a subscription tax or making MDVE absorb
model costs before there is a paying audience.

## The workbench

- Source is CodeMirror over the canonical Mermaid text.
- Preview renders the same text; nodes and links can be selected, edited, linked,
  zoomed, panned, and repositioned with durable layout state.
- Inspector provides byte-preserving structured edits for `flowchart` and `graph` diagrams, including multi-node alignment and distribution.
- A source-backed semantic diagram model gives Preview, Outline, Inspector, and Agent one graph identity and transaction boundary without replacing Mermaid as the durable source.
- Agent results arrive as reviewable proposals with a modeled before/after summary; keep or reject the result before starting another turn.
- Agent runs Codex in the Diagram workspace and streams progress into a durable Conversation.
- History lists immutable, checksummed recovery points, compares a point with
  the current revision, and restores a point as a new revision.

Other Mermaid grammars remain renderable and source-editable, but structured
visual mutation is intentionally unavailable when MDVE cannot prove that it is
safe. Mermaid remains the durable source of truth; the semantic model is a
source-backed projection, not a competing canvas document.

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
| `MDVE_GUMROAD_PRODUCT_ID` | unset | Store product ID used to verify MDVE Pro keys |
| `MDVE_PRO_CHECKOUT_URL` | unset | Store checkout URL shown by the Pro dialog |
| `MDVE_OPENAI_COMPATIBLE_BASE_URL` | saved local value or `https://api.openai.com/v1` | Optional BYOK endpoint override |
| `MDVE_OPENAI_COMPATIBLE_API_KEY` | saved local value | Optional BYOK key override |
| `MDVE_OPENAI_COMPATIBLE_MODEL` | saved local value | Optional BYOK model override |

The development-only `PORT` and `HOST` aliases are also accepted by the server.

## Development status

The package baseline is version `3.0.0`; work continues iteratively on `master`
under the v3 development label dated 2026-08-03. This repository state is not
an official npm or GitHub publication, and the Pro store is not live until its
deployment variables are connected. The release-gate harness remains
available for a future public distribution, but publication-only owner, legal,
registry, and trusted-publishing gates do not block normal development.

## Scope

MDVE is a local Linux application for individual technical users who already
use Mermaid and technical AI tools. Hosted sync, accounts, real-time
collaboration, a fully free-form canvas, mobile editing, and a hosted MDVE AI
service remain outside the current workbench boundary.
