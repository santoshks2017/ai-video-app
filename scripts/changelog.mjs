/**
 * Writes CHANGELOG.md from packages/shared/src/changelog.ts, which is the single
 * source of truth — the same list the app shows under "What's new".
 * Run: npm run changelog
 */
import { writeFile } from 'node:fs/promises';
import { CHANGELOG, APP_VERSION } from '../packages/shared/dist/changelog.js';

const body = [
  '# Changelog',
  '',
  `Current version: **${APP_VERSION}**`,
  '',
  'Minor bumps for every shipped change; the major number moves only for an',
  'overhaul of how the app works. Generated from `packages/shared/src/changelog.ts`',
  '— edit that, then run `npm run changelog`.',
  '',
  ...CHANGELOG.flatMap((r) => [
    `## ${r.version} — ${r.title}`,
    `_${r.date}_`,
    '',
    ...r.changes.map((c) => `- ${c}`),
    '',
  ]),
].join('\n');

await writeFile(new URL('../CHANGELOG.md', import.meta.url), body);
console.log(`CHANGELOG.md written — ${CHANGELOG.length} releases, current ${APP_VERSION}`);
