/** Line icons for the image editor, drawn the way the video editor draws its own. */
export const ICONS = {
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  zoomOut: 'M5 12h14',
  zoomIn: 'M12 5v14M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1C3.6 7.8 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.3-1',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.6-1.8',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  text: 'M5 6h14M12 6v13M9 19h6',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  line: 'M4 12h16',
  picture: 'M4 5h16v14H4zM4 16l5-5 4 4 2.5-2.5L20 17M15.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  dup: 'M8 8h11v11H8zM5 16V5h11',
  del: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  close: 'M6 6l12 12M18 6 6 18',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  front: 'M8 4h12v12H8zM4 8v12h12',
  forward: 'M12 19V5M6 11l6-6 6 6',
  backward: 'M12 5v14M6 13l6 6 6-6',
  back: 'M4 8h12v12H4zM8 4h12v12',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
