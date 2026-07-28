# Use revisioned, file-backed durability

MDVE keeps `diagram.mmd` as the only source of truth and adds conditional durable revisions, browser recovery drafts, and immutable recovery points around it. Plain debounced autosave cannot prevent stale writers or recover closed-tab work, while making every Diagram a Git repository would expose an implementation mechanism without removing the need for an MDVE-native recovery model; the complete contract is recorded in [the durability decision](../../.scratch/mdve-v1/issues/02-choose-durability-and-recovery-contract.md).
