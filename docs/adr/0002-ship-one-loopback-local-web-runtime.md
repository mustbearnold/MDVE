# Ship one loopback local-web runtime

MDVE v1 ships as one loopback-only process launched by `mdve`, serving a version-matched UI and authenticated API from a stable browser origin. Supporting a desktop wrapper or two shells would multiply packaging, update, lifecycle, and security behavior without improving the chosen Linux developer workflow; the evidence and rejected options are in [the delivery-form decision](../../.scratch/mdve-v1/issues/03-choose-v1-delivery-form.md).
