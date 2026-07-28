# Scope durable Conversations to Diagrams

Each Diagram workspace owns its canonical source and may own multiple durable Conversations, each with its own transcript and provider-thread identity but no forked diagram copy. This separates Diagram revision history from conversation continuity and keeps archive reversible without introducing v1 folders or multi-Diagram chat; the full lifecycle is in [the continuity decision](../../.scratch/mdve-v1/issues/04-choose-session-and-conversation-model.md).
