# AI Video App — Master Rules

## What this project is
An app for CarDekho's design team that stores video-generation model API keys and uses them to actually generate AI dealer ad-slot videos from a structured brief plus templates — not just prompt text (that was the prior tool). Dealer-only scope for v1. Core constraint: generation costs Rs 300-1,000 per 10-30s video, so first-time-right accuracy (target >90%) is the central design problem, not a nice-to-have.

## Rules
- Standard approach, no project-specific rules yet.

## Where things live
- Source knowledge (workflow design, the prior tool's data model and defects): OKF Bundle/index.md
- People, acronyms, company terms: global Productivity plugin memory (root CLAUDE.md / memory/) — don't duplicate here
- Decisions made on this project: memory/decisions.md
- Background, stakeholders, constraints: memory/context.md
- Current status and next steps: memory/progress.md
- How I write on this project: memory/voice.md
- Running session log: memory/memory.md

## Saving session state
At the end of a session in this project, run the `updateproject` skill to append decisions, refresh progress, and log what happened. Don't hand-edit these files from inside a generic conversation — use that skill so updates stay consistent.
