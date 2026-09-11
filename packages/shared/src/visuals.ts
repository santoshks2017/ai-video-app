/**
 * Which photo a shot can honestly be built on.
 *
 * Handed only exterior photos, a scene about the dashboard came back as the exterior
 * bent into a cabin — a video model force-fits whatever reference it is given. So
 * each shot is read for the part of the vehicle it frames. A supplied photo of that
 * part is named for the scene; when there is none, the storyboard says a generic
 * visual will be used so the designer can decide, and the model is told to render
 * that part generically instead of reshaping a photo of another.
 */

import type { DealerPhoto } from './types.js';

type Angle = NonNullable<DealerPhoto['angle']>;

interface Topic {
  /** How the part is named to the designer and to the model. */
  label: string;
  /** A two-wheeler has no cabin. */
  bikeLabel?: string;
  /** The library photo angle that shows it. Parts no angle shows need a photo picked by hand. */
  angle?: Angle;
  words: RegExp;
}

// First match wins: the parts inside or under the body come before the outside
// angles, so "rear seat" is the cabin and not the back of the car.
const TOPICS: Topic[] = [
  {
    label: 'interior',
    bikeLabel: 'handlebar and console',
    angle: 'interior',
    words:
      /\b(interior|cabin|dashboard|steering|seats?|upholstery|infotainment|touch ?screen|console|gear (?:lever|knob|selector)|ac vents?|climate control|instrument cluster|speedometer|legroom|headroom|handlebars?)\b/i,
  },
  { label: 'engine bay', words: /\b(engine bay|engine compartment|under the (?:bonnet|hood))\b/i },
  { label: 'boot space', words: /\b(boot space|boot|trunk|cargo area|luggage)\b/i },
  { label: 'sunroof', words: /\b(sunroof|panoramic roof|moonroof)\b/i },
  {
    label: 'rear',
    angle: 'rear',
    words: /\b(rear (?:view|profile|end|three-quarter|3\/4)|tail ?lamps?|tail ?lights?|taillights?|tailgate|exhaust)\b/i,
  },
  {
    label: 'side profile',
    angle: 'side',
    words: /\b(side (?:profile|view|on)|profile shot|alloys?|alloy wheels?|tyres?|tires?|silhouette)\b/i,
  },
  {
    label: 'front',
    angle: 'front',
    words: /\b(front (?:view|profile|end|three-quarter|3\/4|fascia)|grille|headlamps?|headlights?|bonnet|drls?)\b/i,
  },
];

export type SceneVisual =
  /** The designer picked this photo for the scene. */
  | { kind: 'picked'; photo: DealerPhoto }
  /** The shot frames a part that a supplied photo shows. */
  | { kind: 'matched'; photo: DealerPhoto; topic: string }
  /** The shot frames a part that no supplied photo shows. */
  | { kind: 'generic'; topic: string }
  /** Nothing specific to match — the presenter, the showroom, the car on the road. */
  | { kind: 'open' };

export function sceneVisual(
  shot: string,
  picked: string | undefined,
  attachments: DealerPhoto[],
  vehicle: 'car' | 'bike' = 'car',
): SceneVisual {
  const chosen = picked?.trim() ? attachments.find((a) => a.filename === picked.trim()) : undefined;
  if (chosen) return { kind: 'picked', photo: chosen };
  const topic = TOPICS.find((t) => t.words.test(shot));
  if (!topic) return { kind: 'open' };
  const label = vehicle === 'bike' && topic.bikeLabel ? topic.bikeLabel : topic.label;
  const photo = topic.angle
    ? attachments.find((a) => a.kind === 'car-model' && a.angle === topic.angle)
    : undefined;
  return photo ? { kind: 'matched', photo, topic: label } : { kind: 'generic', topic: label };
}

/** The line a scene's visual adds to the prompt, if any. */
export function sceneVisualLine(visual: SceneVisual, vehicle: 'car' | 'bike' = 'car'): string | null {
  switch (visual.kind) {
    case 'picked':
      return visual.photo.kind === 'car-model'
        ? `Build this shot on the supplied reference image ${visual.photo.filename} (${visual.photo.label}) — match the ${vehicle}'s design, colour and angle, filmed as a real ${vehicle} standing in this scene's location, never as the photo itself.`
        : `Build this shot on the supplied reference image ${visual.photo.filename} (${visual.photo.label}) — match what it shows and its angle, filmed as a real scene, never as the photo itself.`;
    case 'matched':
      return `For the ${visual.topic}, take how it looks from the supplied reference image ${visual.photo.filename} (${visual.photo.label}) — on the real ${vehicle} in the scene, never as the photo itself.`;
    case 'generic':
      return `No supplied photo shows the ${visual.topic}. Render a realistic, generic ${visual.topic} that suits this ${vehicle} — do not reshape a reference photo of another part to fake it.`;
    default:
      return null;
  }
}
