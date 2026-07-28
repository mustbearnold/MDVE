# Choose the v1 user and winning job

Type: grilling
Status: resolved
Blocked by:

## Question

Which developer segment should MDVE serve first, and which repeated diagramming job must it perform materially better than a text editor plus Mermaid preview or a general-purpose whiteboard?

## Evidence to use

- MDVE already combines source editing, rendered selection, structured flowchart edits, local files, and Codex-driven transformations.
- The current product is strongest for technical flowcharts and architecture/process diagrams, not free-form drawing.
- A narrow winning job should determine onboarding, templates, editor depth, packaging, and success metrics.

## Comments

## Answer

### Decision

MDVE v1 serves **individual software engineers and technical founders on Linux who already work in Mermaid or Markdown and already use Codex**. Their repeated job is to turn fuzzy technical reasoning or an existing `.mmd` file into a correct, durable, version-control-ready **technical flowchart** by moving fluidly among:

1. Codex-driven structural transformations,
2. direct manipulation of the rendered graph, and
3. precise source editing.

The product promise is:

> Go from fuzzy technical reasoning to a trustworthy Mermaid flowchart without copying work between chat, a text editor, a preview, and a whiteboard.

Architecture diagrams, system workflows, incident paths, and implementation plans are the first representative workloads. They share the same graph-shaped editing model without forcing MDVE to pretend it is a free-form design tool.

### Options considered

| Option | Product fit | Defensibility | v1 scope | Decision |
| --- | --- | --- | --- | --- |
| General Mermaid editor for everyone | Medium | Low | Broad | Reject |
| Cloud team whiteboard and diagram suite | Low | Low | Very broad | Reject |
| Documentation-only IDE companion | Medium | Low | Moderate | Reject |
| Codex-native technical-flowchart workbench | High | High | Focused | Choose |

The general editor is not a sufficient wedge: the official [Mermaid Live Editor](https://mermaid.js.org/intro/getting-started.html) already offers source/preview editing, browser history, samples, gist loading, and PNG/SVG/Markdown export. The team-suite direction is also occupied: official [Mermaid Chart](https://mermaid.js.org/ecosystem/mermaid-chart.html) combines AI generation, a visual whiteboard, storage, comments, plugins, and real-time multi-user collaboration.

MDVE's current implementation uniquely concentrates its value in the remaining seam: Codex operates directly on the local diagram file, the rendered graph is selectable and structurally editable, and raw Mermaid remains the source of truth. Making that loop reliable and recoverable uses the existing architecture instead of requiring accounts, hosted storage, multiplayer state, or a general canvas.

### Product boundaries created by this decision

- Flowcharts receive complete v1 treatment; other Mermaid types may render and remain editable through source and Codex, but do not implicitly qualify for structured visual editing.
- Local ownership, recoverability, semantic correctness, and exportable `.mmd` matter more than template volume or presentation polish.
- Multi-user collaboration, cloud storage, mobile editing, and free-form positioning stay outside v1.
- The first-run experience should begin with a technical intent or existing `.mmd`, not an empty generic canvas.

### Evidence and tradeoffs

This deliberately chooses a smaller initial market. It depends on Linux and a working Codex CLI, and it will not win users whose primary need is presentation design or synchronous collaboration. In return, it gives MDVE a coherent reason to exist beside mature Mermaid editors: one local workspace owns the agent conversation, diagram source, rendered structure, and recovery history.

Confidence: **high (0.86)**. The choice follows directly from current product capability and official competitor coverage. The largest remaining uncertainty is whether structured v1 editing should stay flowchart-only or include one adjacent graph syntax; that is now a separate frontier decision.
