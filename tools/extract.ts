// Runs Heroes Data Parser for one locale of a channel, from Blizzard's servers, and checks it
// extracted the game version expected. The main locale's run also writes the data files and
// pictures; the others keep only their strings (see lib/extraction.ts).
//
//   node tools/extract.ts <live|ptr> <locale> <game version> <output folder>
//
// HDP is downloaded into hdp/ the first time. Its download cache of game files goes where
// HEROESDATAPARSER_DATA_DIR says (the update keeps it in the Actions cache).
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asChannel, ROOT } from './lib/channels.ts';
import { EXTRACTION_LOCALES, HDP_VERSION, hdpArguments, MAIN_LOCALE } from './lib/extraction.ts';

const [, , channelArg, locale, game, outArg] = process.argv;
const channel = asChannel(channelArg);
if (!locale || !EXTRACTION_LOCALES.includes(locale) || !game || !outArg) {
  throw new Error(
    `Usage: extract.ts <live|ptr> <${EXTRACTION_LOCALES.join('|')}> <game version> <output folder>`,
  );
}
const out = join(process.cwd(), outArg);

/** HDP's program in a folder, wherever its archive put it. */
async function findExecutable(folder: string): Promise<string | undefined> {
  try {
    const files = await readdir(folder, { recursive: true });
    const exe = files.find((f) => f === 'HeroesDataParser' || f.endsWith('/HeroesDataParser'));
    return exe && join(folder, exe);
  } catch {
    return undefined;
  }
}

async function hdpExecutable(): Promise<string> {
  const folder = join(ROOT, 'hdp', HDP_VERSION);
  const found = await findExecutable(folder);
  if (found) return found;
  const url =
    'https://github.com/HeroesToolChest/HeroesDataParser/releases/download/' +
    `v${HDP_VERSION}/HeroesDataParser.${HDP_VERSION}-scd-linux-x64.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  await mkdir(folder, { recursive: true });
  const archive = join(folder, 'hdp.tar.gz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', ['xzf', archive, '-C', folder], { stdio: 'inherit' });
  await rm(archive);
  const exe = await findExecutable(folder);
  if (!exe) throw new Error(`No HeroesDataParser in ${url}`);
  await chmod(exe, 0o755);
  return exe;
}

await rm(out, { recursive: true, force: true });
execFileSync(await hdpExecutable(), hdpArguments(channel === 'ptr', locale, out), {
  stdio: 'inherit',
});

const dataFiles = await readdir(join(out, 'data'));
const heroData = dataFiles.find((name) => /^herodata_\d+\.json$/.test(name));
if (!heroData) throw new Error(`No hero data in ${join(out, 'data')}`);
const { meta } = JSON.parse(await readFile(join(out, 'data', heroData), 'utf8'));
if (!String(meta.heroesVersion).startsWith(game)) {
  throw new Error(`HDP extracted ${meta.heroesVersion}; the patch server says ${game}`);
}
if (locale !== MAIN_LOCALE) {
  await rm(join(out, 'data'), { recursive: true, force: true });
  await rm(join(out, 'images'), { recursive: true, force: true });
}
console.log(`${channel} ${locale}: extracted ${meta.heroesVersion}`);
