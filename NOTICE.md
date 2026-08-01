# MDVE notices

Copyright © 2026 Ben Arnold.

MDVE is distributed with third-party open-source dependencies. Those dependencies
retain their own licenses and notices; the MDVE license does not relicense them.
The production dependency set is declared in `package.json` and its lockfile:

- chokidar — MIT
- cors — MIT
- express — MIT

Mermaid, Vite, React, CodeMirror, Zustand, TypeScript, and their transitive
dependencies are used to build the browser application and retain their own
licenses. Before publication, `npm run verify:licenses` must pass against the
lockfile-installed production tree; its output is the complete release license
inventory and is retained with the release evidence.

The exact artifact scope and these terms remain subject to the project's
documented qualified legal review before any public publication.
