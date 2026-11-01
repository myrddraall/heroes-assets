import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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
