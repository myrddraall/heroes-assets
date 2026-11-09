// Takes out of a channel's game, from Blizzard's servers, the pictures Heroes Data Parser's data
// names but doesn't write, into an extraction of it (the main locale's run, tools/extract.ts):
// the hero units' portraits (lib/hero-units.ts) into hero-units/, and the icons the data no longer
// names (lib/retired-icons.ts) into retired-icons/. The update runs it in its publish job, once
// every run's output is merged.
//
//   node tools/extract-pictures.ts <live|ptr> <extraction folder>
//
// HDP's casc-extract does the reading; its download cache goes where HEROESDATAPARSER_DATA_DIR
// says.
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asChannel } from './lib/channels.ts';
import { cascExtract, cascExtractTextures } from './lib/hdp.ts';
import { HERO_UNIT_TEXTURES, missingHeroUnitPortraits } from './lib/hero-units.ts';
import { gatherTextures } from './lib/map-ui.ts';
import { gatherRetiredIcons, ICON_PATTERN, RETIRED_ICON_TEXTURES } from './lib/retired-icons.ts';

const [, , channelArg, outArg] = process.argv;
const channel = asChannel(channelArg);
if (!outArg) throw new Error('Usage: extract-pictures.ts <live|ptr> <extraction folder>');
const out = join(process.cwd(), outArg);
const ptr = channel === 'ptr';

const dataNames = await readdir(join(out, 'data'));
const heroData = dataNames.find((n) => /^herodata_\d+\.json$/.test(n));
if (!heroData) throw new Error(`No herodata in ${join(out, 'data')}`);
const heroes = JSON.parse(await readFile(join(out, 'data', heroData), 'utf8')).items;

const work = join(dirname(out), 'casc-pictures');
await rm(work, { recursive: true, force: true });
// the hero units' portraits HDP names but leaves out
const units = await missingHeroUnitPortraits(heroes, join(out, 'images', 'heroportraits'));
await cascExtractTextures(ptr, units, join(work, 'textures'));
const unitsMissing = await gatherTextures(
  join(work, 'textures'),
  units,
  join(out, HERO_UNIT_TEXTURES),
);
// every ability and talent icon, for those the data no longer names
await cascExtract(ptr, [ICON_PATTERN], join(work, 'icons'));
const retired = await gatherRetiredIcons(
  join(work, 'icons'),
  join(out, 'images'),
  join(out, RETIRED_ICON_TEXTURES),
);
await rm(work, { recursive: true, force: true });

console.log(
  `${channel}: ${units.size - unitsMissing.length} hero unit portraits` +
    (unitsMissing.length ? `, not in the game: ${unitsMissing.join(', ')}` : ''),
);
console.log(`${channel}: ${retired.length} icons the data no longer names`);
