# V1 agent-provider boundary research

**Research date:** 2026-07-28
**Ticket:** `.scratch/mdve-v1/issues/08-choose-v1-agent-provider-boundary.md`
**Question:** Should MDVE v1 remain Codex-only, and what continuity can it honestly promise across providers?

## Recommendation

Ship v1 as **Codex-only**, but replace the current private-file/CLI-wrapper boundary with
Codex's documented **app-server stable API surface** before calling the provider integration
release-ready.

Do not add a second provider to v1. Grok Build is the strongest subscription-shaped follow-up
candidate; Claude Agent SDK is the strongest mature API-key candidate. Both require a separate
adapter and compatibility gate. Gemini is technically credible through ACP with API-key or Vertex
authentication, but Google explicitly prohibits using Gemini CLI OAuth through third-party software.

Provider switching must create a **new MDVE Conversation** from the current durable Diagram
revision. It must never be presented as resuming or transferring the old provider thread.

## Why Codex remains the v1 boundary

OpenAI officially supports ChatGPT subscription sign-in for local Codex work, alongside API-key
sign-in. The CLI can inspect and edit a local repository, run local tools, and resume saved sessions.
Those capabilities match MDVE's wedge: an already-authenticated coding agent edits the canonical
local `diagram.mmd` with native file tools.

Primary sources:

- [OpenAI Codex authentication](https://developers.openai.com/codex/auth)
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli)
- [OpenAI Codex app-server](https://developers.openai.com/codex/app-server)

Adding a provider now would not be a dropdown-only feature. It adds authentication, licensing,
model-catalog, workspace-tool, streaming, cancellation, resume, recovery, transcript, and switch
semantics. The current product has only one implemented provider and one provider thread id per
session. The lower-risk v1 investment is to make the Codex integration depend on an official
contract rather than multiplying adapters before the Conversation model is implemented.

## Standardize v1 on Codex app-server

Yes. Start `codex app-server` over its default stdio JSONL transport, initialize without
`experimentalApi`, and restrict MDVE to these documented stable methods and notifications:

| MDVE need | Stable app-server surface |
| --- | --- |
| Auth/account state | `account/read` and `account/updated` |
| Entitled picker models | `model/list` |
| New provider thread | `thread/start` with the Diagram workspace `cwd` and `workspaceWrite` sandbox |
| Resume provider thread | `thread/resume`, then `turn/start` |
| Stream activity | `turn/started`, item start/completion/deltas, tool progress, `turn/completed` |
| Cancel a turn | `turn/interrupt`, ending with `status: "interrupted"` |

The app-server documentation explicitly says that clients remain on the stable API surface by
omitting the experimental capability. It documents thread start/resume, streamed turn and item
events, and explicit interruption as one lifecycle. MDVE should pin/test a supported Codex runtime
version and validate its generated schema in CI; “stable surface” does not mean versionless.

### Current MDVE gap

`server/src/providers/codex.ts` currently:

- tests authentication by reading `~/.codex/auth.json`, although Codex can officially store
  credentials in the OS keyring;
- scrapes the private `~/.codex/models_cache.json` file and falls back to hard-coded model ids;
- regex-parses top-level values from `~/.codex/config.toml`;
- spawns `codex exec --json` for each turn, parses a small event subset, and resumes with CLI flags;
- translates cancellation into process `SIGTERM` rather than a provider-level interrupted result.

`codex exec --json` is an official automation mode, so the current implementation is not an
unsupported use of the CLI itself. The fragile parts are the adjacent cache/auth/config file
assumptions and the narrower lifecycle contract. App-server replaces those assumptions with
`account/read`, `model/list`, `thread/start|resume`, streamed events, and `turn/interrupt`.

The migration is a recommendation, not evidence that MDVE already implements app-server. Before
cutover, contract tests must prove: ChatGPT login and keyring auth detection, entitled model listing,
workspace-only edits, thread resume after process restart, event normalization, stop behavior, and
recovery of the final on-disk Diagram after completion, failure, or interruption.

## Credible second-provider options

| Candidate | Auth and licensing boundary | Local editing and continuity | V1 judgment |
| --- | --- | --- | --- |
| **Grok Build** | xAI says its early beta is available to SuperGrok and X Premium Plus subscribers and explicitly promotes full ACP for bots and orchestration apps. Its published client is Apache-2.0. | Native local file/shell agent; headless `streaming-json`; stored sessions with resume; ACP JSON-RPC streams `session/update`. “Full ACP” implies the protocol's load-session and cancel contract, but MDVE must verify the shipped version. | Best subscription-shaped post-v1 candidate, not a v1 dependency while the product is explicitly early beta and untested in MDVE. |
| **Claude Agent SDK** | Anthropic supports API keys and named cloud providers. It explicitly says third-party developers may not offer `claude.ai` login or rate limits unless previously approved. | Built-in Read/Edit/Write/Bash; async message streaming; durable local session ids with resume/fork; TypeScript `AbortController` and query interruption. | Strong technical adapter, but API-key billing and secret handling do not preserve MDVE's subscription wedge. |
| **Gemini CLI** | Google-account login supports Code Assist and Google AI subscriptions in Gemini CLI itself. Google explicitly says direct service access through third-party software using Gemini CLI OAuth violates its terms. API-key and Vertex routes remain documented. | Workspace-bounded file tools; ACP JSON-RPC exposes authenticate, new/load session, prompt, cancel, and a proxied filesystem. | Do not offer subscription OAuth in MDVE. Reconsider only through API-key/Vertex auth plus legal and compatibility gates. |

Primary sources:

- [xAI Grok Build announcement](https://x.ai/news/grok-build-cli)
- [xAI Grok Build headless and ACP documentation](https://docs.x.ai/build/cli/headless-scripting)
- [xAI Grok Build source and license](https://github.com/xai-org/grok-build)
- [Agent Client Protocol session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [Agent Client Protocol prompt, streaming, and cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [Anthropic Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Anthropic Agent SDK sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Anthropic TypeScript Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Gemini CLI ACP mode](https://geminicli.com/docs/cli/acp-mode/)
- [Gemini CLI filesystem tools](https://geminicli.com/docs/tools/file-system/)
- [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)
- [Gemini CLI terms and privacy](https://geminicli.com/docs/resources/tos-privacy/)

Do not implement Grok by routing its service through Codex's custom-provider wire format. If MDVE
adds Grok, use Grok Build's own documented ACP/headless surface and test that surface directly.

## Honest provider-switch continuity

A Conversation has exactly one `providerId` and one opaque `providerThreadId`. The provider thread
id is meaningful only to that provider and adapter.

When the user changes provider:

1. Finish or explicitly interrupt the current turn and reconcile `diagram.mmd` from disk.
2. Record the exact current durable Diagram revision as the switch point.
3. Create a new MDVE Conversation with a new provider identity and no inherited provider thread id.
4. Seed the first turn with the current Diagram plus an explicit, bounded handoff note if the user
   chooses one. Label that note as imported context, not resumed provider state.
5. Keep the old Conversation and durable transcript visible and attributable to its original
   provider; resume it only through that original provider when still available.

The product promise is therefore **Diagram continuity and durable transcript access**, not hidden
model-state, tool-state, token-cache, or provider-thread continuity. MDVE must not silently upload a
full transcript to a new provider: that changes disclosure, cost, and privacy boundaries and still
cannot recreate the old provider's internal context.

## Evidence and inference boundaries

Confirmed by primary sources: Codex subscription auth/local work; app-server stable account, model,
thread, event, and interrupt methods; Grok subscription availability, headless streaming, sessions,
and advertised full ACP; Claude tools/sessions/cancellation and its third-party login restriction;
Gemini tools/ACP methods and its explicit third-party OAuth prohibition.

Inferences requiring MDVE tests: exact event normalization, provider binary/version compatibility,
resume after crashes and upgrades, cancellation-to-disk reconciliation, Grok's complete ACP
capability behavior in the shipped beta, and any provider's model-entitlement edge cases.

No evidence supports transferring a native thread identity or full model state between any two of
these providers. The cross-provider boundary above is a product/domain decision built around that
absence, not a claimed provider feature.
