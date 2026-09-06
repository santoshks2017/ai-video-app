---
type: Reference
title: Existing Dealer Video Prompt Builder (v1 Cowork artifact)
description: "The already-built prompt-generation tool (single-file HTML, published as a Claude Artifact) that this new app supersedes/extends: what it does, its data model, validated defects, and the open items flagged when it was handed off toward GitHub/Supabase/Vercel."
tags: [existing-tool, prompt-generation, handoff, prd-source]
status: draft
generated: { by: human:santoshks2017, at: 2026-09-06T14:58:16Z }
sources:
  - id: html-tool
    resource: ../dealer-video-prompt-builder.html
    title: dealer-video-prompt-builder.html
    author: human:santoshks2017 (built by Claude Cowork)
    last_modified: 2026-09-04
  - id: handoff-brief
    resource: ../HANDOFF-BRIEF.md
    title: HANDOFF-BRIEF.md
    author: human:santoshks2017 (built by Claude Cowork)
    last_modified: 2026-09-06
---
# What it does today

A single-file HTML/CSS/JS tool, published as a Claude Artifact with a shared `db` backing store, that generates structured Lumina-AI text prompts (not videos — text only) for 9 dealer ad-slot video categories: Delivery/Handover, Festival/Occasion, Offer/Deal, Product Feature, EV/Electric, New Launch, Test Drive, Customer Testimonial, Showroom Walkaround.[^html-tool] Service, Community/Event, Achievement/Milestone, and Accessories/Detailing were deliberately excluded as not ad-slot-appropriate, though Service may be reconsidered.[^handoff-brief]

It holds three shared team collections — actors, dealers, generations — supports a fictionalize-branding toggle to avoid real trademark/logo issues, and injects a fixed pronunciation/delivery rulebook (gender-locked Hindi verb forms, number/currency pronunciation, an explicit "never invent a figure" accuracy rule) into every generated prompt.[^html-tool]

# The core problem it already solved: multi-part generation

Video generation models cap a single generation at 10-15 seconds and rush voice pacing if asked to fit a longer script in one go. The tool splits a longer video's script into sequential prompts — Part 1 "creates" the first chunk of scenes, Part 2+ ask the model to "extend the video by adding the next N scenes" — with scenes divided as evenly as possible across the number of parts needed (`planScenes()`).[^html-tool]

# Validated defects (from auditing against real reference videos, not assumptions)

- A generated Premier Motors video dropped a 7.49% interest-rate card that was in the prompt — informed a card-count/length validation check.[^handoff-brief]
- A real Honda reference reel used bilingual (Hindi+English) on-screen cards — informed a text-language option.
- Fictionalized-branding runs could show two different dealership names on screen at once (footer defaulted to the real name while on-screen branding showed the fictional one) — fixed by deriving the footer from the same identity shown on screen.[^handoff-brief]

# Open items carried forward (unresolved, relevant to the new app)

1. Whether to re-add Service as a 10th category — the user's own 25-reel evidence set included 2 Service reels despite Service being excluded as "not ad-slot-appropriate."[^handoff-brief]
2. `WORDS_PER_SECOND = 2.2` is an estimate for Hindi spoken pacing, not measured from real audio (Instagram source audio was inaccessible) — flagged as needing real-world validation once the team generates actual videos.[^handoff-brief]
3. No `assets` capability was available in the Artifact context, so actor/dealer photos were stored as compressed base64 thumbnails inline in JSON documents rather than real file uploads — flagged as worth fixing once persistence moves to Supabase Storage.[^handoff-brief]

# Why it's being superseded rather than just extended

The tool only ever produces prompt *text* for the user to paste into Lumina or another video-gen UI manually — it does not call a video generation API, does not manage car-model reference images, and its shared `db` capability is scoped to the publishing Claude account's organization, which likely blocks CarDekho colleagues on separate work accounts from opening it at all.[^handoff-brief] The new app (see [[workflow-pipeline-design]]) is meant to close all three gaps: real API-key-driven generation, an accurate car-model image library, and normal multi-user access control.
