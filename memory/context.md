# Context

## Summary
See OKF Bundle/index.md. Short version: this app replaces the prompt-only Cowork tool with one that actually calls video-gen model APIs (user-supplied keys), builds accurate actor/car-model/attachment reference profiles, and targets >90% first-time-right generation given the Rs 300-1,000 per-video cost of getting it wrong.

## Stakeholders
- Santosh (Business Manager, Digital, CarDekho) — product owner
- CarDekho design team — end users (internal, not dealers directly)

## Constraints
- Dealer ad-slot videos only for v1 (not other CarDekho video use cases)
- Generation cost is high (Rs 300-1,000 per 10-30s video) — first-time-right rate is the central success metric
- Car model reference images must be accurate/current — AI models often default to older generations
- User-uploaded photos/assets must be used as-is, not regenerated or reinterpreted
- Prior tool's shared-library pattern (actors, dealers) and multi-part chunking logic carry forward

## Key facts
-
