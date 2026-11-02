import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { LOCALES, type Channel } from './channels.ts';
import { HERO_UNITS_VERSION } from './hero-units.ts';
import { MAP_TEXT_PATTERNS } from './map-ui.ts';

/** The Heroes Data Parser release the update downloads and runs. */
export const HDP_VERSION = '5.1.0';

/** HDP's extractors, and which also write pictures (`hero:i`). */
const EXTRACTORS: readonly (readonly [name: string, images: boolean])[] = [
  ['hero', true],
  ['unit', true],
  ['emoticon', true],
  ['emoticonpack', false],
  ['matchaward', true],
  ['map', true],
];

/** Strings as HeroesToolChest's own extraction (heroes-data2) writes them: colours filled in. */
const STRING_OPTIONS = [
  '--gs-replace-constant-vars',
  '--gs-replace-style-vars',
  '--gs-preserve-constant-vars',
  '--gs-preserve-style-vars',
];

/**
 * HDP 5.1.0 writes match award pictures only when voice line pictures are asked for: its
 * MatchAwardImageParser checks ExtractImageOptions.VoiceLine instead of MatchAward. So the
 * picture run asks for voice lines too, and tools/extract.ts drops what they bring.
 */
export const AWARD_PICTURES_WORKAROUND = 'voiceline';

/** Bumped when lib/map-ui.ts changes what a map's interface textures are. */
const MAP_UI_VERSION = 2;

/**
 * The locale whose run also writes the data files and pictures. With `--localized-text Extract`
 * the data is the same in every locale's run, so the others only keep their strings.
 */
export const MAIN_LOCALE = 'enus';

export const EXTRACTION_LOCALES = Object.keys(LOCALES);

/**
 * Identifies what an extraction holds, apart from the game build: the HDP version and every
 * option. A rebuild of the same game build can reuse a stored extraction with the same key.
 */
export const EXTRACTION_KEY = createHash('sha256')
  .update(
    JSON.stringify({
      HDP_VERSION,
      EXTRACTORS,
      STRING_OPTIONS,
      EXTRACTION_LOCALES,
      MAP_TEXT_PATTERNS,
      MAP_UI_VERSION,
      HERO_UNITS_VERSION,
      AWARD_PICTURES_WORKAROUND,
    }),
  )
  .digest('hex')
  .slice(0, 16);

/** HDP's command line for one locale of a channel. */

export function hdpArguments(ptr: boolean, locale: string, out: string): string[] {
  const images = locale === MAIN_LOCALE;
  return [
    'online',
    ...(ptr ? ['--download-ptr'] : []),
    ...EXTRACTORS.flatMap(([name, withImages]) => [
      '-e',
      withImages && images ? `${name}:i` : name,
    ]),
    ...(images ? ['-e', `${AWARD_PICTURES_WORKAROUND}:i`] : []),
    '-l',
    locale,
    '--localized-text',
    'Extract',
    ...STRING_OPTIONS,
    '-o',
    out,
  ];
}

/** A release's git tag (git-flow's `{package}/v{version}`). */
export const releaseTag = (version: string): string => `@myrddraall/heroes-assets/v${version}`;

/**
 * Drops what the award pictures workaround (lib/extraction.ts) brings along: the voice lines'
 * data files, pictures and strings, which we don't extract.
 */
export async function dropAwardWorkaround(out: string): Promise<void> {
  const kind = `${AWARD_PICTURES_WORKAROUND}data_`;
  const category = 'voiceLine';
  for await (const path of walk(out)) {
    const name = basename(path);
    if (name.startsWith(kind) || path.includes(`${join('images', 'voicelines')}`)) {
      await rm(path);
      continue;
    }
    if (!name.startsWith('gamestrings_')) continue;
    const doc = JSON.parse(await readFile(path, 'utf8'));
    if (Array.isArray(doc)) {
      // a map's patch of the strings: its operations on voice lines go
      const kept = doc.filter((op: { path: string }) => !op.path.startsWith(`/items/${category}`));
      if (kept.length !== doc.length) await writeFile(path, JSON.stringify(kept, null, 2));
    } else if (doc.items?.[category]) {
      delete doc.items[category];
      doc.meta.dataTypes = doc.meta.dataTypes?.filter((t: string) => t !== 'VoiceLineData');
      await writeFile(path, JSON.stringify(doc, null, 2));
    }
  }
  await rm(join(out, 'images', 'voicelines'), { recursive: true, force: true });
}

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
