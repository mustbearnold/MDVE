# Ship one loopback local-web runtime

MDVE's canonical v1 runtime is one loopback-only process launched by `mdve`,
serving a version-matched UI and authenticated API from a stable origin. The
Electron desktop shell added by [ADR 0009](0009-package-an-electron-desktop-shell.md)
reuses that process and UI; it does not introduce a second server, persistence
path, or diagram model. The original browser-first delivery rationale remains
useful for the CLI and automation surface.
