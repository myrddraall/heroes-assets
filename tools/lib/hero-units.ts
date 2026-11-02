// Hero units' portraits: HDP's hero data names them (the Lost Vikings' minimap icons and target
// portraits, Rexxar's Misha, Chen's spirits, the Firebat's bunker…) but its picture run writes
// only the heroes' own. So the main locale's extraction takes them out of the game as textures
// (hero-units/textures/<name>.dds), the way it takes a map's interface textures (lib/map-ui.ts).
import { readdir } from 'node:fs/promises';

/** Bumped when this changes what the extraction holds. */
export const HERO_UNITS_VERSION = 1;

/** Where in an extraction the hero units' textures are. */
export const HERO_UNIT_TEXTURES = 'hero-units/textures';

interface HeroPortraits {
  portraits?: Record<string, string | string[]>;
  heroUnits?: Record<string, { portraits?: Record<string, string | string[]> }>;
}

/** Every picture a hero's units' portraits name, by file name (`storm_ui_minimapicon_olaf.png`). */
export function heroUnitPortraits(hero: HeroPortraits): string[] {
  return Object.values(hero.heroUnits ?? {}).flatMap((unit) =>
    Object.values(unit.portraits ?? {})
      .flat()
      .filter((file) => file),
  );
}

/**
 * The texture names (file names without the extension, lower case) of the hero units' portraits
 * that HDP didn't write into `images/heroportraits/`.
 */
export async function missingHeroUnitPortraits(
  heroes: Record<string, HeroPortraits>,
  portraitsFolder: string,
): Promise<Set<string>> {
  const written = new Set(
    (await readdir(portraitsFolder).catch(() => [] as string[])).map((f) => f.toLowerCase()),
  );
  return new Set(
    Object.values(heroes)
      .flatMap(heroUnitPortraits)
      .map((file) => file.toLowerCase())
      .filter((file) => !written.has(file))
      .map((file) => file.replace(/\.[^.]+$/, '')),
  );
}
