import { createHash } from 'node:crypto';
import { LOCALES, type Channel } from './channels.ts';
import { MAP_TEXT_PATTERNS } from './map-ui.ts';

/** The Heroes Data Parser release the update downloads and runs. */
export const HDP_VERSION = '5.1.0';

/** HDP's extractors, and which also write pictures (`hero:i`). */
const EXTRACTORS: readonly (readonly [name: string, images: boolean])[] = [
  ['hero', true],
  ['unit', true],
  ['emoticon', true],
  ['emoticonpack', false],
  ['map', true],
];

/** Strings as HeroesToolChest's own extraction (heroes-data2) writes them: colours filled in. */
const STRING_OPTIONS = [
  '--gs-replace-constant-vars',
  '--gs-replace-style-vars',
  '--gs-preserve-constant-vars',
  '--gs-preserve-style-vars',
];

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
