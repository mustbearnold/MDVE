# MDVE 1.0.0 live Codex evidence

Candidate: `9a9d1bfa568626d56e3e9f24bcd380229cb8d4a3`

Checked at: `2026-08-02T03:02:17Z`

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
- `turn/completed` with status `completed`, with the agent replying `READY`.

The observed notification stream included `thread/started`, `turn/started`,
agent-message deltas, item start/completion, token usage, and
`turn/completed`. This is live compatibility evidence for the installed
runtime; it does not replace release-owner attestation or legal approval.
