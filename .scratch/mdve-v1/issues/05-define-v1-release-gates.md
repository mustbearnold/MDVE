# Define the v1 release gates

Type: grilling
Status: open
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

## Comments
