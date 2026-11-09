import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './channels.ts';
import { HDP_VERSION } from './extraction.ts';

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

/** Heroes Data Parser's program, downloaded into hdp/<version>/ the first time. */
export async function hdpExecutable(): Promise<string> {
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

/** Runs HDP with these arguments, its output shown as it goes. */
export async function runHdp(args: readonly string[]): Promise<void> {
  execFileSync(await hdpExecutable(), args, { stdio: 'inherit' });
}

/**
 * Extracts files from the game's storage on Blizzard's servers with HDP's casc-extract, as they
 * are, into `<out>/mods/…` (lower-case paths). `patterns` are globs over the storage's paths.
 */
export async function cascExtract(
  ptr: boolean,
  patterns: readonly string[],
  out: string,
): Promise<void> {
  await runHdp([
    'casc-extract',
    'online',
    ...(ptr ? ['--download-ptr'] : []),
    ...patterns.flatMap((pattern) => ['-i', pattern]),
    '-o',
    out,
  ]);
}

/** Where the game keeps nearly every texture the extraction takes (606 of 607 in build 98348). */
export const TEXTURE_FOLDER = 'mods/heroes.stormmod/base.stormassets/assets/textures';

/**
 * Textures' casc-extract patterns, spread over `runs` runs: each name's exact path in
 * TEXTURE_FOLDER, or with `anywhere` its file name in any folder (`**\/assets/textures/…`).
 */
export function texturePatternBatches(
  names: Iterable<string>,
  runs: number,
  anywhere = false,
): string[][] {
  const sorted = [...new Set(names)].sort();
  const batches: string[][] = Array.from({ length: Math.min(runs, sorted.length) }, () => []);
  sorted.forEach((name, i) =>
    batches[i % batches.length]!.push(
      anywhere ? `**/assets/textures/${name}.dds` : `${TEXTURE_FOLDER}/${name}.dds`,
    ),
  );
  return batches;
}

/** Runs casc-extract with these patterns into `out`, with its own download cache in `cache`. */
async function cascExtractOwnCache(
  ptr: boolean,
  patterns: readonly string[],
  out: string,
  cache: string,
): Promise<void> {
  const exe = await hdpExecutable();
  const args = [
    'casc-extract',
    'online',
    ...(ptr ? ['--download-ptr'] : []),
    ...patterns.flatMap((pattern) => ['-i', pattern]),
    '-o',
    out,
  ];
  await new Promise<void>((resolve, reject) => {
    const run = spawn(exe, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, HEROESDATAPARSER_DATA_DIR: cache },
    });
    run.on('error', reject);
    run.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`casc-extract exited with ${code}`)),
    );
  });
}

/** The texture files (`<name>.dds`, lower case) under a folder. */
async function texturesIn(folder: string): Promise<Set<string>> {
  try {
    const files = await readdir(folder, { recursive: true });
    return new Set(
      files
        .map((f) => f.split('/').pop()!.toLowerCase())
        .filter((f) => f.endsWith('.dds'))
        .map((f) => f.slice(0, -'.dds'.length)),
    );
  } catch {
    return new Set();
  }
}

/**
 * Extracts textures by name into `<out>/mods/…`, quickly: casc-extract matches each pattern against
 * every path in the game's storage one after another (a `**` pattern about 0.6 s on a GitHub
 * runner: 730 took 8 minutes), so each name is its exact path in TEXTURE_FOLDER, spread over a run
 * per processor at once; then the few not there, by name in any folder. Each run downloads into a
 * cache of its own, so none writes another's files.
 */
export async function cascExtractTextures(
  ptr: boolean,
  names: Iterable<string>,
  out: string,
): Promise<void> {
  const wanted = [...new Set(names)];
  const runs = Math.max(1, availableParallelism());
  const caches = join(tmpdir(), `hdp-texture-caches-${process.pid}`);
  try {
    const extract = (batches: string[][]) =>
      Promise.all(
        batches.map((patterns, i) =>
          cascExtractOwnCache(ptr, patterns, out, join(caches, String(i))),
        ),
      );
    await extract(texturePatternBatches(wanted, runs));
    const found = await texturesIn(out);
    const rest = wanted.filter((name) => !found.has(name.toLowerCase()));
    if (rest.length) await extract(texturePatternBatches(rest, runs, true));
  } finally {
    await rm(caches, { recursive: true, force: true });
  }
}
