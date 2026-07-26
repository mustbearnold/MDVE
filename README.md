# MDVE — Mermaid Diagram Visual Editor

A local Linux app for editing Mermaid diagrams three ways at once: as text, by
clicking the rendered diagram, and by asking an LLM agent that reads and edits
the diagram itself.

The first agent backend is **Codex on your ChatGPT subscription** — MDVE shells
out to the `codex` CLI you are already logged into, so no API key and no token
handling.

## Quick start

```bash
npm install && npm run dev
```

Then open http://localhost:5173. In production mode the server also serves the
built UI on a single port:

```bash
npm run build && npm start
```

Requirements: Node 20+, and `codex` on your `PATH`, logged in (`codex login`).

## Layout

| Pane | What it does |
| --- | --- |
| Source (left) | CodeMirror editor over the raw `.mmd` text |
| Preview (centre) | Live Mermaid render; click a node or link to select it, scroll to zoom, drag to pan |
| Inspector (top right) | Edit the selected node's label, id, shape; link it to another node; edit or delete links |
| Chat (bottom right) | Agent that reads and edits the diagram |

Toolbar: new/open/rename diagram, add node, layout direction, undo/redo, import
`.mmd`, export `.mmd` / SVG / PNG.

## How the agent edits the diagram

Every diagram is a session directory under `~/.mdve/sessions/<uuid>/`:

```
diagram.mmd    the diagram — the single source of truth
AGENTS.md      instructions telling the agent what this workspace is
session.json   title, timestamps, Codex thread id
```

The server runs `codex exec --json -C <session dir> -s workspace-write`, so the
agent uses its own native file tools to read and rewrite `diagram.mmd`. There is
no bespoke tool protocol to keep in sync. The server watches the file with
chokidar and pushes changes to the browser over SSE, so agent edits appear in
the editor as they land.

Follow-up turns use `codex exec resume <thread id>`, so the agent keeps the
conversation context across messages. The thread id is stored in
`session.json`.

## Visual editing model

The Mermaid text is always the source of truth — there is no separate diagram
model that can drift from it. `web/src/mermaid/parse.ts` parses each line into
either a statement (a chain of node tokens joined by links) or an opaque raw
line. Visual edits in `mutate.ts` rewrite only the lines they touch, so
comments, `classDef`s, subgraphs and any syntax the parser does not model are
preserved byte for byte.

Structured editing covers `flowchart` / `graph` diagrams. Other diagram types
still render and can be edited as text or through the agent; the inspector says
so rather than pretending.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Backend port |
| `HOST` | `127.0.0.1` | Backend bind address |
| `MDVE_HOME` | `~/.mdve` | Where sessions are stored |
| `MDVE_CODEX_BIN` | `codex` | Path to the Codex CLI |
| `MDVE_CODEX_USER_CONFIG` | unset | Set to `1` to load your `~/.codex/config.toml` (MCP servers, hooks, custom model settings). Off by default because it makes every turn slower |
| `MDVE_SERVER` | `http://127.0.0.1:8787` | Backend the Vite dev proxy targets |

## Adding another provider

`server/src/providers/types.ts` defines the whole contract: `status()`,
`models()`, and `run(opts, emit)` streaming `AgentEvent`s. Implement it, register
it in `server/src/index.ts`, and it appears in the chat provider dropdown. An
API-key provider (Anthropic or OpenAI) is the natural second one; it would need
its own `get_diagram` / `set_diagram` tools instead of the workspace-file trick,
since it has no shell.

## Known limits

- Codex turns carry your `~/.codex` skills and plugins into context (~60k input
  tokens per turn, mostly cached). Trimming those speeds MDVE up.
- Node positions are Mermaid's automatic layout; there is no free-form dragging.
- Subgraph membership is preserved but not editable from the inspector yet.
