/**
 * Gemini Omni Flash client wrapper (PRD P0.1 / P0.7).
 *
 * STUB — not wired to the real API yet. Phase 1 opens with a 15-minute empirical
 * spike (see spikes/) to confirm whether the conversational-edit context carries
 * attachment/reference grounding across sequential extend calls. Do not finalise
 * the chunking contract here until that spike has run.
 */

import type { PromptPart } from '@ava/shared';

export interface OmniFlashClip {
  partNum: number;
  /** URL / storage path of the generated clip once real. */
  uri: string;
  seconds: number;
}

export interface OmniFlashInput {
  parts: PromptPart[];
  /** Reference image URIs (dealer photos, car-model set) to ground the generation. */
  referenceImages: string[];
  aspect: string;
}

export class OmniFlashNotConfiguredError extends Error {
  code = 'omni-flash-not-configured';
  constructor() {
    super('GOOGLE_API_KEY is not set on the server — cannot call Gemini Omni Flash.');
  }
}

export class OmniFlashNotImplementedError extends Error {
  code = 'omni-flash-not-implemented';
  constructor() {
    super(
      'Omni Flash integration is stubbed in this build. Run the Phase 1 continuity spike, then implement generate().',
    );
  }
}

export async function generate(
  _input: OmniFlashInput,
  apiKey: string | undefined,
): Promise<OmniFlashClip[]> {
  if (!apiKey) throw new OmniFlashNotConfiguredError();
  // TODO(phase-1): sequential create → extend calls, one per part, carrying the
  // prior clip forward per Omni Flash's conversational continuity model.
  throw new OmniFlashNotImplementedError();
}
