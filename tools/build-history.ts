// Builds a channel's past builds (sources/<channel>/history) into <channel>/history/, as patches:
//
//   <channel>/history/index.json         the past builds, newest first
//   <channel>/history/<game>.json        the build's files as a patch of the build after it (the
//                                        newest past build's, of the channel's own files)
//   files/<hash>.webp                    a past build's pictures that differ from the build after
//                                        it's, once each by content, shared by both channels
//                                        (pictures no history names any more are removed)
//
// Each past build is built with tools/build-channel.ts from its stored extraction, so a change to
// the tools rebuilds history too. In a past build's files, a picture that is the same as the
// build after it's is named where that one is (the channel's own file, or a history file).
//
//   node tools/build-history.ts <live|ptr>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, posix, relative } from 'node:path';
import { asChannel, ROOT } from './lib/channels.ts';
import { diff, type Documents } from './lib/patches.ts';
import { builds, writeExtraction } from './lib/sources.ts';

const channel = asChannel(process.argv[2]);
const own = join(ROOT, channel);
const history = join(own, 'history');
/** The shared store of past builds' pictures, as a channel's files name it. */
const FILES = '../files';

/** A built folder: its JSON files (parsed) and its other files (by content hash), by path. */
interface Built {
  docs: Documents;
  /** Path → content hash. */
  files: Map<string, string>;
}

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const hashOf = (data: Buffer): string =>
  createHash('sha256').update(data).digest('hex').slice(0, 20);

async function readBuilt(folder: string, skip: string[] = []): Promise<Built> {
  const built: Built = { docs: new Map(), files: new Map() };
  for await (const path of walk(folder)) {
    const name = relative(folder, path).split('\\').join('/');
    if (skip.some((s) => name === s || name.startsWith(`${s}/`))) continue;
    if (name.endsWith('.json')) built.docs.set(name, JSON.parse(await readFile(path, 'utf8')));
    else built.files.set(name, hashOf(await readFile(path)));
  }
  return built;
}

/**
 * A document with every string that names one of the build's files (relative to the document's
 * folder) pointing where that file is kept instead.
 */
function relocate(doc: unknown, docPath: string, where: ReadonlyMap<string, string>): unknown {
  const folder = posix.dirname(docPath);
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const target = posix.normalize(posix.join(folder, value));
      const kept = where.get(target);
      return kept && kept !== target ? posix.relative(folder, kept) : value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
    }
    return value;
  };
  return visit(doc);
}

await rm(history, { recursive: true, force: true });
const work = join(tmpdir(), `heroes-assets-history-${channel}`);

// the channel's own build: its files are where they are
const current = await readBuilt(own, ['history']);
let after = {
  docs: current.docs,
  hashes: current.files,
  where: new Map([...current.files.keys()].map((path) => [path, path])),
};

const index: { game: string; origin: string; patch: string }[] = [];
let first = true;
for await (const { meta, docs } of builds(channel)) {
  if (first) {
    first = false; // the newest stored build is the channel's own
    continue;
  }
  const extraction = join(work, 'extraction');
  const output = join(work, 'built');
  await writeExtraction(docs, meta.game, extraction);
  await rm(output, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [join(ROOT, 'tools', 'build-channel.ts'), channel, extraction, output],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  const built = await readBuilt(output);

  // where each picture is kept: where the build after it keeps the same picture, else a history
  // file named by its content
  const afterByHash = new Map<string, string>();
  for (const [path, hash] of after.hashes) afterByHash.set(hash, after.where.get(path)!);
  const where = new Map<string, string>();
  for (const [path, hash] of built.files) {
    const same = afterByHash.get(hash);
    if (same) {
      where.set(path, same);
      continue;
    }
    const kept = `${FILES}/${hash}${extname(path)}`;
    where.set(path, kept);
    const target = join(own, kept);
    if (!(await stat(target).catch(() => null))) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(output, path), target);
    }
  }
  const relocated: Documents = new Map(
    [...built.docs].map(([path, doc]) => [path, relocate(doc, path, where)]),
  );
  const patch = diff(after.docs, relocated);
  const file = `${meta.game}.json`;
  await mkdir(history, { recursive: true });
  await writeFile(
    join(history, file),
    `${JSON.stringify({ game: meta.game, origin: meta.origin, patch })}\n`,
  );
  index.push({ game: meta.game, origin: meta.origin, patch: file });
  console.log(
    `${channel} ${meta.game}: ${Object.keys(patch).length} files differ, ` +
      `${[...where.values()].filter((w) => w.startsWith(`${FILES}/`)).length} pictures kept in files/`,
  );
  after = { docs: relocated, hashes: built.files, where };
}
await rm(work, { recursive: true, force: true });
if (index.length) {
  await writeFile(join(history, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
// the shared store keeps only the pictures some channel's history still names
const named = new Set<string>();
for (const other of ['live', 'ptr']) {
  const folder = join(ROOT, other, 'history');
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    const text = await readFile(join(folder, name), 'utf8');
    for (const [, file] of text.matchAll(/files\/([0-9a-f]+\.[a-z]+)/g)) named.add(file!);
  }
}
let removed = 0;
for (const name of await readdir(join(ROOT, 'files')).catch(() => [] as string[])) {
  if (!named.has(name)) {
    await rm(join(ROOT, 'files', name));
    removed++;
  }
}
console.log(
  `${channel}: ${index.length} past builds${removed ? `, ${removed} unused pictures removed` : ''}`,
);
