// Takes out of a channel's game, from Blizzard's servers, what its folder needs beyond Heroes Data
// Parser's output and doesn't need that output for: each map's interface textures
// (lib/map-ui.ts) into map-ui/, its camps and the units a unit card shows (lib/map-units.ts) into
// map-units/, and the textures the interface sheets take (lib/ui-sheet-sources.ts) into
// ui-sheets/. The update runs it alongside HDP's runs; the folder is merged with theirs.
//
//   node tools/extract-game-files.ts <live|ptr> <output folder>
//
// HDP's casc-extract does the reading; its download cache goes where HEROESDATAPARSER_DATA_DIR
// says (the update keeps it in the Actions cache).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asChannel } from './lib/channels.ts';
import { cascExtract, cascExtractTextures } from './lib/hdp.ts';
import {
  gatherTextures,
  MAP_TEXT_PATTERNS,
  mapTextures,
  readMaps,
  readMods,
} from './lib/map-ui.ts';
import { MAP_UNIT_PATTERNS, mapUnits, readModTexts } from './lib/map-units.ts';
import {
  readSheetSources,
  sheetTextures,
  UI_SHEET_SOURCES,
  UI_SHEET_TEXTURES,
} from './lib/ui-sheet-sources.ts';

const [, , channelArg, outArg] = process.argv;
const channel = asChannel(channelArg);
if (!outArg) throw new Error('Usage: extract-game-files.ts <live|ptr> <output folder>');
const out = join(process.cwd(), outArg);
const ptr = channel === 'ptr';

await rm(out, { recursive: true, force: true });
const work = join(dirname(out), 'casc-work');
await rm(work, { recursive: true, force: true });

// the maps (their .s2mv) and their mods' text files first, then the textures they name
await cascExtract(ptr, [...MAP_TEXT_PATTERNS, ...MAP_UNIT_PATTERNS], join(work, 'text'));
const mods = await readMods(join(work, 'text'));
const mapMods = await readMaps(join(work, 'text'));
const titles = [...mapMods.keys()].sort();
if (!titles.length) throw new Error(`No maps read from ${join(work, 'text')}`);
const maps = mapTextures(mapMods, mods, titles);
// each map's camps and the units a unit card shows; their portraits go in the map's sheet with
// its interface textures, those it borrows from the base data too
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
// the textures the interface sheets take
const sheetTextureNames = new Set(
  [...(await readSheetSources(UI_SHEET_SOURCES)).values()].flatMap((s) => [...sheetTextures(s)]),
);
// the textures they name, quickly (lib/hdp.ts)
await cascExtractTextures(ptr, [...names, ...sheetTextureNames], join(work, 'textures'));
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
  `${channel}: ${sheetTextureNames.size - sheetsMissing.length} interface sheet textures` +
    (sheetsMissing.length ? `, not in the game: ${sheetsMissing.join(', ')}` : ''),
);
console.log(
  `${channel}: map units of ${Object.keys(camps.maps).length} maps, ` +
    `${Object.values(camps.maps).reduce((n, m) => n + m.camps.length, 0)} camp types`,
);
