# Fund the desktop product with local-first Pro and BYOK

MDVE v3 keeps the complete local Mermaid editor free: source editing, visual
flowchart editing, durable history, recovery, preview, and ordinary exports do
not require an account or a payment. Agent access remains bring-your-own:
Codex continues to own its ChatGPT entitlement, while an OpenAI-compatible
provider lets a user connect OpenAI, OpenRouter, Ollama, LM Studio, or another
compatible endpoint with a key that stays in the user's local MDVE data
directory.

The initial commercial offer is MDVE Pro: a one-time $49 early-access license
for the current major version, with the option to move to $59 after the first
100 customers. Pro's first paid capability is a clean desktop presentation
mode. It is deliberately useful to technical users who already make diagrams
but does not put a toll gate in front of the core editor. The license is
verified through a merchant-of-record checkout and cached for a 30-day offline
grace period; the app never sends a key to an MDVE service or exposes it to the
renderer.

The checkout product ID and URL are deployment configuration rather than fake
hard-coded credentials (`MDVE_GUMROAD_PRODUCT_ID` and
`MDVE_PRO_CHECKOUT_URL`). Until those values are connected to a real store,
the product remains a monetization-ready development build, not a live paid
offering. Gumroad is acceptable for this first test because it has no monthly
platform fee and handles transaction tax as merchant of record; the software
license itself remains the thing being sold, not a hosted AI service.

A recurring Cloud tier is intentionally deferred. It should only be added if
users demonstrate willingness to pay for encrypted sync, sharing,
collaboration, or hosted AI credits. Those features create real ongoing
infrastructure and model costs, so putting them behind a subscription before
there is demand would make the business less credible, not more.

Success is measured by paid conversion from active local users, activation
completion, presentation-mode usage, refund rate, and BYOK setup completion.
The price and feature boundary remain hypotheses until the first 20 paid
customers and their support conversations validate them.
