# Choose the v1 agent-provider boundary

Type: grilling
Status: open
Blocked by: 04

## Question

Should v1 remain Codex-only or support a second agent provider, and what
continuity promise should MDVE make when Conversations contain provider-specific
thread identities that cannot be resumed or transferred across providers?

## Evidence to use

- The primary user already uses Codex, and MDVE's strongest wedge is
  subscription-authenticated Codex editing the canonical local file with native
  file tools.
- A Conversation belongs to one Diagram but has one provider identity and
  provider-thread identity; its transcript remains durable even when its provider
  thread cannot resume.
- The server already has a provider interface, but only Codex is implemented and
  exposed. The UI currently assumes one provider when restoring model choices.
- An API-key provider cannot reuse the Codex workspace-file mechanism and needs
  explicit diagram tools, authentication, catalog, streaming, cancellation,
  resume, recovery, and compatibility gates.
- Changing providers must create a new Conversation from the current durable
  Diagram revision; it may not pretend to continue an incompatible provider
  thread.

## Comments
