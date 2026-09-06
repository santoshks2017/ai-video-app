---
type: Playbook
title: AI Video Generation Pipeline Design
description: "The end-to-end workflow Santosh sketched in Excalidraw for turning a brief into a finished dealer video: brief intake, profile generation (actor/attachment/car model), scene/script generation, storyboard, master prompt, multi-step generation, and final preview."
tags: [workflow, video-generation, pipeline, prd-source]
status: draft
generated: { by: human:santoshks2017, at: 2026-09-06T14:58:16Z }
sources:
  - id: workflow-diagram
    resource: ../Workflow.excalidraw.md
    title: Workflow.excalidraw.md
    author: human:santoshks2017
    last_modified: 2026-09-06
---
# Pipeline stages (as sketched)

The Excalidraw board lays out a linear pipeline, run per-project (one project = one client/dealer/campaign), sitting under two persistent layers: Universal Settings (global instructions, standard instructions, pronunciation rules) and Client Info & Docs (uploads, name/address/phone, brands/models, showroom images, offers).[^workflow-diagram]

**1. Brief intake.** User (CarDekho design team) fills an "Input Prompt / Brief" with: Avatar yes/no (if yes, choose from actor library or create new), Duration (10/15/20/30/60s — the UI should show which social formats each duration can serve: FB/IG/YT), Model Specific yes/no (if yes, name the car model so its reference images get fetched), Dimension (16:9 / 9:16, again mapped to which formats it serves), Resolution (480p/720p/1080p).[^workflow-diagram]

**2. Identify use case**, then **identify supporting media** needed, which fans out into three profile-generation steps:
- Generate Actor Profile (the on-camera presenter)
- Generate Attachments Profile — reference images either as a simple text-to-image prompt, a single reference image, or a "complete 360" set; every reference image gets labelled with a description and its filename is saved so it can be cited by name later in the master prompt
- Generate Car Model Profile — sourced from CarDekho's own car model library (not generic AI generation), fetching complete picture/video coverage and building a profile "from all angles" so the video-gen model isn't left to invent an outdated or wrong car design[^workflow-diagram]

**3. Generate Scenes & Scripts.** Frame/scene count is derived from total video length; each scene gets its own definition plus a script and voiceover line.[^workflow-diagram]

**4. Generate Storyboard** — a structured, editable plan (this maps directly to what the reference "Video Plan" UI shows: a scene-by-scene table with roll type, timing, image reference, and voiceover script per row).[^workflow-diagram]

**5. Generate Master Prompt**, referencing attachments by the filenames saved in step 2 (rather than re-describing them inline).[^workflow-diagram]

**6. Multi-step prompt generation** — the same "create, then extend" chunking logic already built in the current prompt-builder tool (see [[existing-prompt-builder-tool]]), because a single generation call can't reliably produce a long, accurately-paced video.[^workflow-diagram]

**7. Feed into Video Gen API** — this is the new capability: the app calls the video generation model directly using a stored API key, rather than the user copy-pasting a prompt into a separate tool.[^workflow-diagram]

**8. Present final video** — Video Preview, a Frame Timeline, and an "AI prompt / chat section" for iterating on the result conversationally rather than only by re-editing the master prompt.[^workflow-diagram]

# Two persistent settings layers

- **Universal Settings**: Global Instructions (standard instructions — the pronunciation/delivery rulebook) — shared across every project.
- **Client Info & Docs**: per-client persistent facts — uploads, pronunciation notes, name/address/phone, brands/models to use or avoid, showroom images, current offers.[^workflow-diagram]

Each project is scoped by `Project_Name = Client name or campaign name`, and contains its own Brief, Actors, Scenes, and Storyboard — i.e. project-specific state sits on top of the two universal layers, not mixed into them.[^workflow-diagram]

# Stated user

"User: Cardekho design team" — confirms this is an internal tool for the design team generating videos on behalf of dealers, not a self-serve tool for dealers themselves.[^workflow-diagram]
