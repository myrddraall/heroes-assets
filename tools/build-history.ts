// Builds a channel's past builds (sources/<channel>/history) into <channel>/history/, as patches:
//
//   <channel>/history/index.json         the past builds, newest first
//   <channel>/history/<game>.json        the build's files as a patch of the build after it (the
//                                        newest past build's, of the channel's own files)
//   <channel>/history/tools.json         hashes of the tools that built them and of the stored
//                                        past builds they were built from
//   files/<hash>.webp                    a past build's pictures that differ from the build after
//                                        it's, once each by content, shared by both channels
//                                        (pictures no history names any more are removed)
//
// In a past build's files, a picture that is the same as the build after it's (at the same path)
// is named where that one is: the channel's own file, or a history file. So a past build's patch
// names only the pictures that differ from the build after it, and depends on no build but that
// one.
//
//   node tools/build-history.ts <live|ptr> [the channel's folder before this update]
//
// When the tools and the stored past builds are the ones that built the history in the folder
// given (but for the build the update adds), only what the new
// current build changes is redone: the build it replaces becomes a past build as it was built,
// and the newest past build's pictures that were the replaced build's own files are named where
// they are kept now. Older past builds don't change. Otherwise (other tools, or no folder given)
// every past build is built again with tools/build-channel.ts from its stored extraction.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, posix, relative } from 'node:path';
import { asChannel, ROOT, type ChannelVersion } from './lib/channels.ts';
import { apply, diff, type Documents, type DocumentsPatch } from './lib/patches.ts';
import { builds, readHistory, writeExtraction } from './lib/sources.ts';

const channel = asChannel(process.argv[2]);
const previousFolder = process.argv[3];
const own = join(ROOT, channel);
const history = join(own, 'history');
/** The shared store of past builds' pictures, as a channel's files name it. */
const FILES = '../files';

interface IndexEntry {
  game: string;
  origin: string;
  patch: string;
}

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

/** A hash of everything that decides what the tools build: their code and the packages' lock. */
async function toolsHash(): Promise<string> {
  const hash = createHash('sha256');
  const files: string[] = [];
  for await (const path of walk(join(ROOT, 'tools'))) files.push(path);
  for (const path of [...files.sort(), join(ROOT, 'pnpm-lock.yaml')]) {
    hash.update(relative(ROOT, path)).update(await readFile(path));
  }
  return hash.digest('hex').slice(0, 20);
}

/**
 * A document with every string that names one of the files in `where` (relative to the
 * document's folder) pointing where that file is kept instead.
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

/** Keeps a picture in the shared store under its content's name (once). */
async function keep(source: string, hash: string): Promise<string> {
  const kept = `${FILES}/${hash}${extname(source)}`;
  const target = join(own, kept);
  if (!(await stat(target).catch(() => null))) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  return kept;
}

/**
 * Where an older build's pictures are kept, against the build after it: at the same path when
 * the same picture is there (named as that build names it), else in the shared store.
 */
async function placesOf(
  built: Built,
  folder: string,
  after: { files: ReadonlyMap<string, string>; where: ReadonlyMap<string, string> },
): Promise<Map<string, string>> {
  const where = new Map<string, string>();
  for (const [path, hash] of built.files) {
    where.set(
      path,
      after.files.get(path) === hash
        ? after.where.get(path)!
        : await keep(join(folder, path), hash),
    );
  }
  return where;
}

async function writeEntry(entry: IndexEntry, patch: DocumentsPatch): Promise<void> {
  await mkdir(history, { recursive: true });
  await writeFile(
    join(history, entry.patch),
    `${JSON.stringify({ game: entry.game, origin: entry.origin, patch })}\n`,
  );
  console.log(`${channel} ${entry.game}: ${Object.keys(patch).length} files differ`);
}

/**
 * What a channel's folder holds that build-channel doesn't write: its past builds, and the
 * current release's version.json (history/index.json names each past build's game).
 */
const NOT_BUILT = ['history', 'version.json'];

const stored = await readHistory(channel);
const tools = await toolsHash();

/** A hash of the stored past builds (sources/<channel>/history), the newest `skip` left out. */
async function sourcesHash(skip: number): Promise<string> {
  const hash = createHash('sha256');
  for (const meta of stored.slice(skip)) {
    const file = join(ROOT, 'sources', channel, 'history', `${meta.game}.json`);
    hash.update(meta.game).update(await readFile(file));
  }
  return hash.digest('hex').slice(0, 20);
}
const current = await readBuilt(own, NOT_BUILT);
const currentWhere = new Map([...current.files.keys()].map((path) => [path, path]));

/** The history in the folder before this update, when the same tools built it. */
async function previousHistory(): Promise<{
  built: Built;
  version: ChannelVersion | null;
  index: IndexEntry[];
} | null> {
  if (!previousFolder) return null;
  const stamp = await readFile(join(previousFolder, 'history', 'tools.json'), 'utf8').catch(
    () => '',
  );
  if (!stamp) return null;
  const { tools: builtWith, sources } = JSON.parse(stamp) as { tools: string; sources?: string };
  const index = JSON.parse(await readFile(join(previousFolder, 'history', 'index.json'), 'utf8'));
  const version = JSON.parse(
    await readFile(join(previousFolder, 'version.json'), 'utf8').catch(() => 'null'),
  );
  // the update adds the replaced build as the newest stored past build; the rest must be as before
  const added = stored[0]?.game === version?.game ? 1 : 0;
  if (builtWith !== tools || sources !== (await sourcesHash(added))) return null;
  return { built: await readBuilt(previousFolder, NOT_BUILT), version, index };
}

const previous = await previousHistory();
const index: IndexEntry[] = [];

if (previous) {
  // ── Same tools: the replaced build joins history as it was built; the newest past build's
  //    pictures that were its files are named where they are kept now; the rest stays as it is
  const replaced = previous.built;
  const oldWhere = await placesOf(replaced, previousFolder!, {
    files: current.files,
    where: currentWhere,
  });
  const newGame = stored[0]?.game === previous.version?.game;
  const replacedDocs: Documents = new Map(
    [...replaced.docs].map(([path, doc]) => [path, relocate(doc, path, oldWhere)]),
  );
  await rm(history, { recursive: true, force: true });
  let afterDocs = current.docs;
  if (newGame) {
    const entry = {
      game: stored[0]!.game,
      origin: stored[0]!.origin,
      patch: `${stored[0]!.game}.json`,
    };
    await writeEntry(entry, diff(current.docs, replacedDocs));
    index.push(entry);
    afterDocs = replacedDocs;
  }
  for (const [i, entry] of previous.index.entries()) {
    if (i === 0) {
      // the newest past build: rebuilt from its patch of the replaced build, re-pointed
      const { patch } = JSON.parse(
        await readFile(join(previousFolder!, 'history', entry.patch), 'utf8'),
      ) as { patch: DocumentsPatch };
      const docs = apply(previous.built.docs, patch);
      const repointed: Documents = new Map(
        [...docs].map(([path, doc]) => [path, relocate(doc, path, oldWhere)]),
      );
      await writeEntry(entry, diff(afterDocs, repointed));
    } else {
      await mkdir(history, { recursive: true });
      await cp(join(previousFolder!, 'history', entry.patch), join(history, entry.patch));
    }
    index.push(entry);
  }
} else {
  // ── Other tools (or no earlier history): every past build built again from its extraction
  await rm(history, { recursive: true, force: true });
  const work = join(tmpdir(), `heroes-assets-history-${channel}`);
  let after = { docs: current.docs, files: current.files, where: currentWhere };
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
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const built = await readBuilt(output);
    const where = await placesOf(built, output, after);
    const relocated: Documents = new Map(
      [...built.docs].map(([path, doc]) => [path, relocate(doc, path, where)]),
    );
    const entry = { game: meta.game, origin: meta.origin, patch: `${meta.game}.json` };
    await writeEntry(entry, diff(after.docs, relocated));
    index.push(entry);
    after = { docs: relocated, files: built.files, where };
  }
  await rm(work, { recursive: true, force: true });
}

if (index.length) {
  await writeFile(join(history, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(
    join(history, 'tools.json'),
    `${JSON.stringify({ tools, sources: await sourcesHash(0) })}\n`,
  );
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
  `${channel}: ${index.length} past builds (${previous ? 'updated' : 'all built'})` +
    `${removed ? `, ${removed} unused pictures removed` : ''}`,
);
