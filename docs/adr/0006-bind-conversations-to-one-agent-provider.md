# Bind Conversations to one Agent provider

MDVE v1 supports Codex as its only Agent provider and binds every Conversation immutably to Codex plus its opaque provider-thread identity. A future provider must start a new Conversation at the current durable Diagram revision, because substituting or replaying an incompatible provider thread under an existing Conversation would falsely claim continuity; the complete boundary and admission gates are recorded in [the Agent-provider decision](../../.scratch/mdve-v1/issues/08-choose-v1-agent-provider-boundary.md).
