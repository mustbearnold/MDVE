# Choose the v1 agent-provider boundary

Type: grilling
Status: resolved
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

## Answer

### Decision

MDVE v1 is **Codex-only**. Codex is the product's only supported Agent
provider, not merely the first item in a public provider picker. V1 keeps a
narrow internal adapter boundary so Codex transport details do not leak into
Diagram or Conversation storage, but that seam is not a promise that arbitrary
providers or models are interchangeable.

Each Conversation is immutably bound to one `agentProviderId` and at most one
opaque `providerThreadId` in that provider's namespace. A model or reasoning
effort is a per-turn setting inside that binding; changing a model does not
change the Agent provider. The server enforces the binding. It may never pass a
thread id created by one provider to another adapter, even if a client submits a
different provider id.

Because only Codex is supported, v1 removes the provider selector from the
normal chat UI. It shows Codex connection state plus model and reasoning-effort
controls. The server rejects any non-Codex provider id instead of exposing a
placeholder integration that has not passed the release contract.

### Conversation continuity contract

- **Continue conversation** resumes only the exact Codex provider thread bound
  to that Conversation.
- If the thread is missing, incompatible, or rejected, the Conversation becomes
  **Cannot resume**. Its MDVE transcript, turn outcomes, and revision boundaries
  remain readable; MDVE does not create a replacement thread under the same
  Conversation identity.
- **New conversation from current Diagram** creates a new MDVE Conversation and
  a new Codex thread from the latest acknowledged durable revision. It does not
  erase or rename the old Conversation.
- A future provider change must use **New conversation with _provider_** from the
  current durable Diagram revision. Provider history is not transferable. A
  future explicit handoff summary may be added as visibly copied context, but it
  is not a resumed thread and MDVE must not replay the old transcript as if the
  new provider produced it.
- MDVE's durable transcript is the user-visible evidence record. A provider
  thread is only a continuation capability and may expire independently.

### Codex integration boundary

V1 targets Codex's documented app-server JSON-RPC methods without opting into
`experimentalApi`: `account/read` for connection state, `model/list` for the
catalog, `thread/start` and `thread/resume` for continuity, streamed turn/item
notifications for durable progress, and `turn/interrupt` for cancellation. The
app-server owns ChatGPT authentication and token refresh; MDVE never reads,
copies, logs, or stores Codex credentials.

This replaces two brittle parts of the current adapter: directly reading
`$CODEX_HOME/models_cache.json` and maintaining a partial hand-written mapping of
`codex exec --json` output. App-server can generate schemas specific to the
installed Codex version, so MDVE must pin and test a supported Codex version
range, validate the initialization/schema handshake, and fail visibly when the
installed version is incompatible. The local `codex-cli 0.145.0` still labels
app-server experimental; that is a release risk to prove through compatibility
gates, not a reason to fall back to private cache formats or silently degraded
continuity.

ChatGPT-managed Codex authentication is the supported v1 credential path and
the basis of the product's subscription-backed claim. Other Codex credential or
model-provider modes are not automatically supported merely because the local
CLI can use them. MDVE must label the active mode accurately and must not claim
subscription billing for an API-key-backed run.

### Future provider admission gate

A second Agent provider is a post-v1 feature and must pass all of these before
it appears in production:

1. A first-party supported integration and credential path whose terms allow
   use inside MDVE, with billing and data handling shown before the first turn.
2. Equivalent lifecycle semantics for availability, model catalog, streaming,
   cancellation, same-provider resume, explicit resume failure, and durable turn
   outcomes.
3. Safe access to the Diagram workspace through native local-file tools or a
   typed MDVE diagram-tool contract that preserves `diagram.mmd` as the only
   source of truth and obeys the Agent write lease.
4. A compatibility suite covering new, continued, stopped, failed,
   interrupted, restarted, and unavailable-thread Conversations without silent
   fallback or cross-provider id reuse.
5. UI and migration behavior that creates a new Conversation for a provider
   change while preserving the old transcript and revision evidence.

### Options considered

| Option | Winning-job fit | Continuity risk | Credential and policy risk | V1 scope | Decision |
| --- | --- | --- | --- | --- | --- |
| Codex-only product with an internal adapter | High | Low | Low | Focused | Choose |
| Codex plus Grok Build ACP | High | Medium | Medium | Large | Defer |
| Codex plus Claude Agent SDK or Gemini API | Medium-high | Medium | High | Large | Defer |
| Generic CLI or API-key provider marketplace | Medium | High | High | Very large | Reject for v1 |

Grok Build, Claude Agent SDK, and Gemini CLI demonstrate that a second local
coding agent can stream structured events, use filesystem tools, and resume its
own sessions. That proves future technical feasibility, not portable
continuity. Their session ids, tool events, retention, credentials, and billing
remain provider-specific.

Grok Build is the strongest subscription-shaped follow-up because xAI documents
subscriber access, headless streaming JSON, stored-session resume, and an Agent
Client Protocol surface intended for orchestration. It remains an early beta and
is untested against MDVE's write, recovery, and continuity contracts, so it is
not a v1 dependency. A later Grok adapter must use Grok Build's own documented
ACP or headless surface; routing Grok through Codex's custom model-provider wire
format would keep Codex as the agent runtime and would not satisfy this boundary.

Anthropic's guidance for product builders points third-party products toward
API-key or supported-cloud authentication and prohibits offering `claude.ai`
login without prior approval. Its treatment of Agent SDK third-party
subscription use is also in transition. Gemini's official FAQ forbids
third-party software from piggybacking on Gemini CLI OAuth and directs
integrations to API or Vertex AI credentials.

Adding either in v1 would therefore add a credential surface, billing UX,
provider-specific retention and failure states, tool compatibility work, and a
second release matrix for users outside the chosen initial segment. It would not
improve the primary user's core loop enough to justify weakening the trust and
recovery work that differentiates MDVE.

### Evidence and trade-offs

- OpenAI documents Codex as included with ChatGPT plans and explicitly supports
  local repository work. Its [Codex SDK](https://developers.openai.com/codex/sdk)
  is intended for embedding Codex in applications, and its
  [app-server](https://developers.openai.com/codex/app-server) documents account,
  model, thread, event-stream, and interrupt methods needed by MDVE.
- The current MDVE source exposes a generic provider selector but stores only one
  `threadId` on the Diagram metadata. Once a second provider exists, the current
  request path could send that id to the newly selected adapter; immutable
  Conversation binding must replace this UI-only selection behavior.
- The official [Claude account guidance](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
  directs product builders toward API-key or supported-cloud authentication.
  The [Agent SDK subscription notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
  confirms that third-party subscription treatment is changing and should not
  become a v1 dependency.
- Gemini documents native filesystem tools, JSONL events, and resumable local
  sessions, but its [official FAQ](https://geminicli.com/docs/resources/faq/)
  explicitly rejects third-party reuse of CLI OAuth credentials.
- xAI's [Grok Build announcement](https://x.ai/news/grok-build-cli) and
  [headless/ACP documentation](https://docs.x.ai/build/cli/headless-scripting)
  make it the strongest post-v1 candidate, but they describe an early beta whose
  exact lifecycle behavior still requires MDVE compatibility tests.
- Full source links and the evidence/inference boundary are captured in the
  [primary-source research report](../../../docs/research/2026-07-28-v1-agent-provider-boundary.md).

The chosen boundary gives up a provider-choice marketing claim and may exclude
users who do not use Codex. In return, every v1 Conversation has one testable
continuity model, one supported credential path, one agent tool behavior, and
one release matrix. The internal adapter preserves a future extension point
without charging v1 users the reliability cost of an unproved abstraction.

Confidence: **high (0.95)**. Official Codex surfaces cover the required
lifecycle, the source shows the current cross-provider identity hazard, and the
strongest alternatives confirm feasibility while exposing materially different
auth and retention contracts.

## Comments

- Claimed for the Wayfinder session on 2026-07-28. GitHub mirror:
  [#9](https://github.com/mustbearnold/MDVE/issues/9).
