# Add an Electron desktop shell over the canonical runtime

MDVE keeps the loopback CLI/browser path as its canonical runtime and adds an
Electron desktop shell for the v1 development baseline. The Electron main
process starts the same compiled server, assigns a free loopback port, creates
the same one-use authenticated bootstrap session, and opens the production UI
in a native window. The browser and desktop surfaces therefore share the
Mermaid source of truth, API, persistence, agent provider, and interaction
tests.

Electron is the fit for the current implementation because the server is
already a Node runtime and the desktop shell can reuse it without a Rust
rewrite or a second native backend. Tauri remains a possible later packaging
choice if a native footprint or platform integration requirement justifies the
additional runtime boundary.

The CLI remains supported for terminal-managed use, automation, and browser
workflows. The desktop build is an additional Linux AppImage artifact for
iterative testing, not an official npm or GitHub publication. Both shells use
the same `~/.mdve` data directory and must pass the shared web/product gates;
the desktop launch contract additionally verifies the packaged window and
preview context menu against the real AppImage.

This supersedes the desktop-wrapper rejection in [ADR 0002](0002-ship-one-loopback-local-web-runtime.md) while preserving its decision that
MDVE has one canonical loopback server and no competing client-side diagram
model.
