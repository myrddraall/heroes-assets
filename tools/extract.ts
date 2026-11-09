// Runs Heroes Data Parser for one locale of a channel, from Blizzard's servers, and checks it
// extracted the game version expected. The main locale's run also writes the data files and
// pictures, each map's interface textures (lib/map-ui.ts) into map-ui/, its camps and the units a
// unit card shows (lib/map-units.ts) into map-units/, the hero units'
// portraits HDP leaves out (lib/hero-units.ts) into hero-units/, and the textures the interface
// sheets take (lib/ui-sheets.ts) into ui-sheets/ and the icons the data no longer names
// (lib/retired-icons.ts) into retired-icons/; the others keep only their strings (see
// lib/extraction.ts).
//
//   node tools/extract.ts <live|ptr> <locale> <game version> <output folder>
//
// HDP is downloaded into hdp/ the first time. Its download cache of game files goes where
// HEROESDATAPARSER_DATA_DIR says (the update keeps it in the Actions cache).
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asChannel } from './lib/channels.ts';
import {
  dropAwardWorkaround,
  EXTRACTION_LOCALES,
  hdpArguments,
  MAIN_LOCALE,
} from './lib/extraction.ts';
import { cascExtract, runHdp } from './lib/hdp.ts';
import { HERO_UNIT_TEXTURES, missingHeroUnitPortraits } from './lib/hero-units.ts';
import { gatherRetiredIcons, ICON_PATTERN, RETIRED_ICON_TEXTURES } from './lib/retired-icons.ts';
import {
  gatherTextures,
  MAP_TEXT_PATTERNS,
  mapTextures,
  readMaps,
  readMods,
  texturePattern,
} from './lib/map-ui.ts';
import { MAP_UNIT_PATTERNS, mapUnits, readModTexts } from './lib/map-units.ts';
import {
  readSheetSources,
  sheetTextures,
  UI_SHEET_SOURCES,
  UI_SHEET_TEXTURES,
} from './lib/ui-sheet-sources.ts';

const [, , channelArg, locale, game, outArg] = process.argv;
const channel = asChannel(channelArg);
if (!locale || !EXTRACTION_LOCALES.includes(locale) || !game || !outArg) {
  throw new Error(
    `Usage: extract.ts <live|ptr> <${EXTRACTION_LOCALES.join('|')}> <game version> <output folder>`,
  );
}
const out = join(process.cwd(), outArg);
const ptr = channel === 'ptr';

async function dataFile(
  kind: string,
): Promise<{ meta: { heroesVersion: string }; items: Record<string, object> }> {
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
  await cascExtract(ptr, [...MAP_TEXT_PATTERNS, ...MAP_UNIT_PATTERNS], join(work, 'text'));
  const mods = await readMods(join(work, 'text'));
  const titles = Object.keys((await dataFile('mapdata')).items);
  const mapMods = await readMaps(join(work, 'text'));
  const maps = mapTextures(mapMods, mods, titles);
  // each map's camps and the units a unit card shows (lib/map-units.ts); their portraits go in the
  // map's sheet with its interface textures, those it borrows from the base data too
  const camps = mapUnits(mapMods, await readModTexts(join(work, 'text')), titles);
  for (const [title, own] of Object.entries(camps.maps)) {
    const textures = new Set(maps[title] ?? []);
    for (const unit of Object.values(own.units)) unit.portraits.forEach((p) => textures.add(p));
    maps[title] = [...textures].sort();
  }
  const names = new Set(Object.values(maps).flat());
  if (!names.size) {
    throw new Error(`No map interface textures: ${mods.size} mods read from ${join(work, 'text')}`);
  }
  // the hero units' portraits come out with them
  const units = await missingHeroUnitPortraits(
    (await dataFile('herodata')).items,
    join(out, 'images', 'heroportraits'),
  );
  // the textures the interface sheets take (lib/ui-sheets.ts)
  const sheetTextureNames = new Set(
    [...(await readSheetSources(UI_SHEET_SOURCES)).values()].flatMap((s) => [...sheetTextures(s)]),
  );
  await cascExtract(
    ptr,
    [...names, ...units, ...sheetTextureNames].map(texturePattern),
    join(work, 'textures'),
  );
  // every ability and talent icon, for those the data no longer names (lib/retired-icons.ts)
  await cascExtract(ptr, [ICON_PATTERN], join(work, 'icons'));
  const retired = await gatherRetiredIcons(
    join(work, 'icons'),
    join(out, 'images'),
    join(out, RETIRED_ICON_TEXTURES),
  );
  const sheetsMissing = await gatherTextures(
    join(work, 'textures'),
    sheetTextureNames,
    join(out, UI_SHEET_TEXTURES),
  );
  const missing = await gatherTextures(
    join(work, 'textures'),
    names,
    join(out, 'map-ui', 'textures'),
  );
  const unitsMissing = await gatherTextures(
    join(work, 'textures'),
    units,
    join(out, HERO_UNIT_TEXTURES),
  );
  await writeFile(
    join(out, 'map-ui', 'maps.json'),
    `${JSON.stringify({ maps, missing }, null, 2)}\n`,
  );
  await mkdir(join(out, 'map-units'), { recursive: true });
  await writeFile(join(out, 'map-units', 'maps.json'), `${JSON.stringify(camps)}\n`);
  await rm(work, { recursive: true, force: true });
  const unmatched = titles.filter((title) => !maps[title]);
  console.log(
    `${channel}: interface textures of ${Object.keys(maps).length} maps, ${names.size - missing.length} ` +
      `found, ${missing.length} named but not in the game` +
      (unmatched.length ? `; no mod for ${unmatched.join(', ')}` : ''),
  );
  console.log(
    `${channel}: ${units.size - unitsMissing.length} hero unit portraits` +
      (unitsMissing.length ? `, not in the game: ${unitsMissing.join(', ')}` : ''),
  );
  console.log(
    `${channel}: ${sheetTextureNames.size - sheetsMissing.length} interface sheet textures` +
      (sheetsMissing.length ? `, not in the game: ${sheetsMissing.join(', ')}` : ''),
  );
  console.log(`${channel}: ${retired.length} icons the data no longer names`);
  console.log(
    `${channel}: map units of ${Object.keys(camps.maps).length} maps, ` +
      `${Object.values(camps.maps).reduce((n, m) => n + m.camps.length, 0)} camp types`,
  );
} else {
  await rm(join(out, 'data'), { recursive: true, force: true });
  await rm(join(out, 'images'), { recursive: true, force: true });
}
console.log(`${channel} ${locale}: extracted ${meta.heroesVersion}`);
