// Runs Heroes Data Parser for one locale of a channel, from Blizzard's servers, and checks it
// extracted the game version expected. The main locale's run also writes the data files and
// pictures; the others keep only their strings (see lib/extraction.ts). What the game holds beyond
// HDP's output comes from tools/extract-game-files.ts (alongside) and tools/extract-pictures.ts
// (after, from this run's data).
//
//   node tools/extract.ts <live|ptr> <locale> <game version> <output folder>
//
// HDP is downloaded into hdp/ the first time. Its download cache of game files goes where
// HEROESDATAPARSER_DATA_DIR says (the update keeps it in the Actions cache).
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { asChannel } from './lib/channels.ts';
import {
  dropAwardWorkaround,
  EXTRACTION_LOCALES,
  hdpArguments,
  MAIN_LOCALE,
} from './lib/extraction.ts';
import { runHdp } from './lib/hdp.ts';

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
} else {
  await rm(join(out, 'data'), { recursive: true, force: true });
  await rm(join(out, 'images'), { recursive: true, force: true });
}
console.log(`${channel} ${locale}: extracted ${meta.heroesVersion}`);
