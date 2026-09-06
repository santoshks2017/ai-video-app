/**
 * SPIKE 1 — Omni Flash context continuity across create → extend.
 * See spikes/README.md. Fill in the real API calls; this is the harness.
 */

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('Set GOOGLE_API_KEY to run this spike.');
  process.exit(1);
}

const CREATE_PROMPT = `Create a 6-second 9:16 photorealistic Indian automotive dealership video.
A single presenter (female, late 20s, maroon polo dress) walks toward a silver SUV on a showroom floor.
On-screen card: "Byte Premier Motors". End on a natural cut, mid-motion.`;

const EXTEND_PROMPT = `EXTEND the previous video by 6 more seconds. Continue from the exact last frame —
same presenter, same SUV, same showroom, same lighting. She stops beside the bonnet and gestures to camera.
On-screen card changes to: "Book your test drive today".`;

async function main(): Promise<void> {
  console.log('SPIKE 1 — Omni Flash continuity');
  console.log('TODO: POST', CREATE_PROMPT.slice(0, 40), '…');
  console.log('TODO: POST extend with the returned session/context', EXTEND_PROMPT.slice(0, 40), '…');
  console.log(`
Inspect the two clips for:
  - car design drift (shape / colour / badge)
  - presenter identity drift (face / outfit)
  - on-screen text: did the card update cleanly, or garble?
  - did the extend need the reference image re-supplied?

Record the answer in memory/decisions.md and adjust apps/api/src/omniFlash.ts + buildPrompt.ts.
`);
}

main();
