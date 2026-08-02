# MDVE 1.0.0 live Codex evidence

Candidate: `240342afb2daf52504949a4e82629516a750a48e`

Checked at: `2026-08-02T02:16:55Z`

The real authenticated `codex-cli 0.146.0` app-server was started over stdio
against an isolated temporary workspace. The run used the model returned by
`model/list` (`gpt-5.6-sol`), the catalog's supported `low` reasoning effort,
`approvalPolicy: "never"`, and a workspace-write sandbox restricted to that
temporary directory with network access disabled.

The following protocol lifecycle completed successfully:

- `initialize` / `initialized`, with `experimentalApi: false`;
- `account/read`, returning a ChatGPT account (no account identifier recorded);
- `model/list`, returning seven models and a usable default;
- `thread/start`, returning a provider thread identity;
- `turn/start` with a no-file-access prompt; and
- `turn/completed` with status `completed`.

The observed notification stream included `thread/started`, `turn/started`,
agent-message deltas, item start/completion, token usage, and
`turn/completed`. This is live compatibility evidence for the installed
runtime; it does not replace release-owner attestation or legal approval.
