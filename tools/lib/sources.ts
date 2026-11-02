// The extractions every build was made from, kept so any build can be rebuilt (sources/):
//
//   sources/blobs/<hash>.<ext>            every picture and texture, once, by content
//   sources/<channel>/latest/             the newest build's extraction in full: meta.json, and
//                                         its JSON files under docs/ (blobs.json names its files)
//   sources/<channel>/history/index.json  the older builds, newest first
//   sources/<channel>/history/<game>.json each one as a patch of the build after it
//
// An extraction is a folder of JSON files and pictures (what tools/extract.ts writes). File names
// carry the build (herodata_98348.json); stored, the build reads {build}, so a file kept the same
// between builds is the same document.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { ROOT, type Channel } from './channels.ts';
import { apply, diff, type Documents, type DocumentsPatch } from './patches.ts';
import type { SourceMeta } from './source-meta.ts';

export { latestMeta, type SourceMeta } from './source-meta.ts';

const SOURCES = join(ROOT, 'sources');
const BLOBS = join(SOURCES, 'blobs');
/** The document that names an extraction's files: path → blob. */
const BLOB_LIST = 'blobs.json';

interface HistoryEntry extends SourceMeta {
  readonly patch: DocumentsPatch;
}

const buildOf = (game: string): string => game.split('.').pop()!;
const toStored = (path: string, game: string): string =>
  path.replaceAll(`_${buildOf(game)}`, '_{build}');
const fromStored = (path: string, game: string): string =>
  path.replaceAll('_{build}', `_${buildOf(game)}`);

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown, indent = 2): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, indent)}\n`);
}

/** An extraction folder's documents, with its other files stored as blobs (named in blobs.json). */
export async function readExtraction(folder: string, game: string): Promise<Documents> {
  const docs: Documents = new Map();
  const blobs: Record<string, string> = {};
  await mkdir(BLOBS, { recursive: true });
  for await (const path of walk(folder)) {
    const name = toStored(relative(folder, path).split('\\').join('/'), game);
    if (name.endsWith('.json')) {
      docs.set(name, await readJson(path));
      continue;
    }
    const data = await readFile(path);
    const blob = `${createHash('sha256').update(data).digest('hex').slice(0, 20)}${extname(path).toLowerCase()}`;
    blobs[name] = blob;
    await writeFile(join(BLOBS, blob), data, { flag: 'wx' }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  docs.set(BLOB_LIST, Object.fromEntries(Object.entries(blobs).sort()));
  return docs;
}

/** Writes an extraction folder from documents (blobs copied back from the store). */
export async function writeExtraction(
  docs: Documents,
  game: string,
  folder: string,
): Promise<void> {
  await rm(folder, { recursive: true, force: true });
  for (const [name, doc] of docs) {
    if (name === BLOB_LIST) continue;
    await writeJson(join(folder, fromStored(name, game)), doc);
  }
  for (const [name, blob] of Object.entries(docs.get(BLOB_LIST) as Record<string, string>)) {
    const path = join(folder, fromStored(name, game));
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(BLOBS, blob), path);
  }
}

const latestFolder = (channel: Channel): string => join(SOURCES, channel, 'latest');
const historyFolder = (channel: Channel): string => join(SOURCES, channel, 'history');

/** The newest stored build of a channel: its meta and documents; null before the first. */
export async function readLatest(
  channel: Channel,
): Promise<{ meta: SourceMeta; docs: Documents } | null> {
  const folder = latestFolder(channel);
  let meta: SourceMeta;
  try {
    meta = await readJson<SourceMeta>(join(folder, 'meta.json'));
  } catch {
    return null;
  }
  const docs: Documents = new Map();
  for await (const path of walk(join(folder, 'docs'))) {
    docs.set(relative(join(folder, 'docs'), path).split('\\').join('/'), await readJson(path));
  }
  return { meta, docs };
}

async function writeLatest(channel: Channel, meta: SourceMeta, docs: Documents): Promise<void> {
  const folder = latestFolder(channel);
  await rm(folder, { recursive: true, force: true });
  await writeJson(join(folder, 'meta.json'), meta);
  for (const [name, doc] of docs) await writeJson(join(folder, 'docs', name), doc);
}

/** The older builds of a channel, newest first. */
export async function readHistory(channel: Channel): Promise<SourceMeta[]> {
  try {
    return await readJson<SourceMeta[]>(join(historyFolder(channel), 'index.json'));
  } catch {
    return [];
  }
}

async function readEntry(channel: Channel, game: string): Promise<HistoryEntry> {
  return readJson<HistoryEntry>(join(historyFolder(channel), `${game}.json`));
}

async function writeEntry(channel: Channel, entry: HistoryEntry): Promise<void> {
  // compact: patches are read by tools, and git stores them once anyway
  await writeJson(join(historyFolder(channel), `${entry.game}.json`), entry, 0);
}

async function writeIndex(channel: Channel, history: readonly SourceMeta[]): Promise<void> {
  await writeJson(join(historyFolder(channel), 'index.json'), history);
}

const metaOf = ({ game, extraction, origin }: SourceMeta): SourceMeta =>
  extraction === undefined ? { game, origin } : { game, extraction, origin };

/**
 * Stores a new extraction as a channel's newest build. The build it replaces becomes the newest
 * entry of the history (a patch of the new one); an extraction of the same build again (new
 * extraction settings) replaces it, and the entry after it is patched against the new one.
 */
export async function storeLatest(
  channel: Channel,
  meta: SourceMeta,
  docs: Documents,
): Promise<void> {
  const latest = await readLatest(channel);
  const history = await readHistory(channel);
  if (latest && latest.meta.game !== meta.game) {
    await writeEntry(channel, { ...metaOf(latest.meta), patch: diff(docs, latest.docs) });
    history.unshift(metaOf(latest.meta));
  } else if (latest && history.length) {
    const before = apply(latest.docs, (await readEntry(channel, history[0]!.game)).patch);
    await writeEntry(channel, { ...metaOf(history[0]!), patch: diff(docs, before) });
  }
  await writeLatest(channel, metaOf(meta), docs);
  await writeIndex(channel, history);
}

/**
 * Every stored build of a channel, newest first, as its meta and documents, one at a time (each
 * is the one before it with its patch applied).
 */
export async function* builds(
  channel: Channel,
): AsyncGenerator<{ meta: SourceMeta; docs: Documents }> {
  const latest = await readLatest(channel);
  if (!latest) return;
  yield latest;
  let docs = latest.docs;
  for (const meta of await readHistory(channel)) {
    docs = apply(docs, (await readEntry(channel, meta.game)).patch);
    yield { meta, docs };
  }
}

/** Drops the stored past builds from the `keep`-th on (to import them again). */
export async function truncateHistory(channel: Channel, keep: number): Promise<void> {
  const history = await readHistory(channel);
  for (const meta of history.slice(keep)) {
    await rm(join(historyFolder(channel), `${meta.game}.json`), { force: true });
  }
  await writeIndex(channel, history.slice(0, keep));
}

/** Adds an older build after the oldest stored one (for importing past builds, oldest last). */
export async function appendOlder(
  channel: Channel,
  oldest: Documents,
  meta: SourceMeta,
  docs: Documents,
): Promise<void> {
  const history = await readHistory(channel);
  await writeEntry(channel, { ...metaOf(meta), patch: diff(oldest, docs) });
  history.push(metaOf(meta));
  await writeIndex(channel, history);
}
