// Runs Heroes Data Parser for one locale of a channel, from Blizzard's servers, and checks it
// extracted the game version expected. The main locale's run also writes the data files and
// pictures, and each map's interface textures (lib/map-ui.ts) into map-ui/; the others keep only
// their strings (see lib/extraction.ts).
//
//   node tools/extract.ts <live|ptr> <locale> <game version> <output folder>
//
// HDP is downloaded into hdp/ the first time. Its download cache of game files goes where
// HEROESDATAPARSER_DATA_DIR says (the update keeps it in the Actions cache).
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asChannel } from './lib/channels.ts';
import {
  dropAwardWorkaround,
  EXTRACTION_LOCALES,
  hdpArguments,
  MAIN_LOCALE,
} from './lib/extraction.ts';
import { cascExtract, runHdp } from './lib/hdp.ts';
import {
  gatherTextures,
  MAP_TEXT_PATTERNS,
  mapTextures,
  readMaps,
  readMods,
  texturePattern,
} from './lib/map-ui.ts';

const [, , channelArg, locale, game, outArg] = process.argv;
const channel = asChannel(channelArg);
if (!locale || !EXTRACTION_LOCALES.includes(locale) || !game || !outArg) {
  throw new Error(
    `Usage: extract.ts <live|ptr> <${EXTRACTION_LOCALES.join('|')}> <game version> <output folder>`,
  );
}
const out = join(process.cwd(), outArg);
const ptr = channel === 'ptr';

async function dataFile(kind: string): Promise<{ meta: { heroesVersion: string }; items: object }> {
  const names = await readdir(join(out, 'data'));
  const name = names.find((n) => new RegExp(`^${kind}_\\d+\\.json$`).test(n));
  if (!name) throw new Error(`No ${kind} in ${join(out, 'data')}`);
  return JSON.parse(await readFile(join(out, 'data', name), 'utf8'));
}

await rm(out, { recursive: true, force: true });
await runHdp(hdpArguments(ptr, locale, out));

const { meta } = await dataFile('herodata');
if (!String(meta.heroesVersion).startsWith(game)) {
  throw new Error(`HDP extracted ${meta.heroesVersion}; the patch server says ${game}`);
}

if (locale === MAIN_LOCALE) {
  await dropAwardWorkaround(out);

  // each map's interface textures: its mods' text files first, then the textures they name
  const work = join(dirname(out), 'casc-work');
  await rm(work, { recursive: true, force: true });
  await cascExtract(ptr, MAP_TEXT_PATTERNS, join(work, 'text'));
  const mods = await readMods(join(work, 'text'));
  const titles = Object.keys((await dataFile('mapdata')).items);
  const maps = mapTextures(await readMaps(join(work, 'text')), mods, titles);
  const names = new Set(Object.values(maps).flat());
  if (!names.size) {
    throw new Error(`No map interface textures: ${mods.size} mods read from ${join(work, 'text')}`);
  }
  await cascExtract(ptr, [...names].map(texturePattern), join(work, 'textures'));
  const missing = await gatherTextures(
    join(work, 'textures'),
    names,
    join(out, 'map-ui', 'textures'),
  );
  await writeFile(
    join(out, 'map-ui', 'maps.json'),
    `${JSON.stringify({ maps, missing }, null, 2)}\n`,
  );
  await rm(work, { recursive: true, force: true });
  const unmatched = titles.filter((title) => !maps[title]);
  console.log(
    `${channel}: interface textures of ${Object.keys(maps).length} maps, ${names.size - missing.length} ` +
      `found, ${missing.length} named but not in the game` +
      (unmatched.length ? `; no mod for ${unmatched.join(', ')}` : ''),
  );
} else {
  await rm(join(out, 'data'), { recursive: true, force: true });
  await rm(join(out, 'images'), { recursive: true, force: true });
}
console.log(`${channel} ${locale}: extracted ${meta.heroesVersion}`);
