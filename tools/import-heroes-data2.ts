// Imports HeroesToolChest's heroes-data2 builds older than a channel's own into its history in
// sources/ (lib/sources.ts), as extractions like ours: the same files (only the kinds we
// extract, strings only of the categories we keep), pictures from heroes-images (the same HDP
// output, byte for byte) by the names the data uses. heroes-data2 has no map mod data, so these
// builds' map sheets hold only the objective icons. Both repositories are MIT licensed.
//
//   node tools/import-heroes-data2.ts <live|ptr>
//
// Run once per channel after its first own build is stored; builds already in the history are
// left alone. Uses `gh` for heroes-images' file list.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asChannel, ROOT } from './lib/channels.ts';
import type { Documents } from './lib/patches.ts';
import jsonPatch, { type Operation } from 'fast-json-patch';
import { appendOlder, builds, readExtraction, readHistory, readLatest } from './lib/sources.ts';

const DATA = 'https://raw.githubusercontent.com/HeroesToolChest/heroes-data2/main/heroesdata';
const IMAGES = 'https://raw.githubusercontent.com/HeroesToolChest/heroes-images/main/heroesimages';
const CACHE = join(ROOT, 'hdp', 'import-cache');

const channel = asChannel(process.argv[2]);

interface HdpMeta {
  json: 'full' | 'patch';
  'depends-on'?: string;
  extracted: boolean;
  files: Record<string, unknown>;
}

async function cached(url: string, file: string): Promise<Buffer> {
  const path = join(CACHE, file);
  try {
    return await readFile(path);
  } catch {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url);
      if (response.ok) {
        const data = Buffer.from(await response.arrayBuffer());
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, data);
        return data;
      }
      if (attempt === 4 || response.status === 404) {
        throw new Error(`${url}: ${response.status} ${response.statusText}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

const json = async <T>(dir: string, path: string): Promise<T> =>
  JSON.parse((await cached(`${DATA}/${dir}/${path}`, `data2/${dir}/${path}`)).toString('utf8'));

const metas = new Map<string, Promise<HdpMeta>>();
const metaOf = (dir: string): Promise<HdpMeta> => {
  if (!metas.has(dir)) metas.set(dir, json<HdpMeta>(dir, '.hdp.json'));
  return metas.get(dir)!;
};

const at = (files: unknown, keys: readonly string[]): unknown =>
  keys.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], files);

/**
 * One file of a heroes-data2 version in full: a version is either full or a JSON patch of the
 * one it depends on, so this walks back to the nearest full one and patches forward (as
 * hero-data's provider does). `keys` find the file in `.hdp.json`'s files; `folder` holds it.
 */
async function rebuild(dir: string, folder: string, keys: readonly string[]): Promise<unknown> {
  const chain: string[] = [];
  for (let current = dir; ;) {
    const meta = await metaOf(current);
    chain.unshift(current);
    if (meta.extracted && meta.json === 'full') break;
    if (!meta['depends-on']) throw new Error(`heroes-data2: no full version behind ${dir}`);
    current = meta['depends-on'];
  }
  let doc: unknown;
  for (const version of chain) {
    const meta = await metaOf(version);
    if (!meta.extracted) continue;
    const name = at(meta.files, keys);
    if (typeof name !== 'string')
      throw new Error(`heroes-data2: ${version} has no ${keys.join('/')}`);
    const body = await json<unknown>(version, `${folder}/${name}`);
    doc =
      meta.json === 'full'
        ? body
        : jsonPatch.applyPatch(doc, body as Operation[], false, true).newDocument;
  }
  return doc;
}

/** Every string ending in a picture's extension, anywhere in a document. */
function pictureNames(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (/\.(png|apng)$/i.test(value)) into.add(value.toLowerCase());
  } else if (Array.isArray(value)) value.forEach((v) => pictureNames(v, into));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => pictureNames(v, into));
  return into;
}

// ── What our own extraction holds, to import the same ─────────────────────────────────────────

const latest = await readLatest(channel);
if (!latest) throw new Error(`${channel}: store an extraction of our own first`);
const latestBuild = Number(latest.meta.game.split('.').pop());
const names = [...latest.docs.keys()];
const dataKinds = names.flatMap((n) => /^data\/([a-z]+)_\{build\}\.json$/.exec(n)?.[1] ?? []);
const mapKinds = new Set(
  names.flatMap((n) => /^data\/maps\/[^/]+\/([a-z]+)_\{build\}\.patch\.json$/.exec(n)?.[1] ?? []),
);
const categories = (name: string): Set<string> =>
  new Set(Object.keys((latest.docs.get(name) as { items: object }).items));
const stringCategories = categories('gamestrings/gamestrings_{build}_enus.json');
const mapStringCategories = categories('gamestrings/gamestrings_mapdata_{build}_enus.json');

const keepCategories = (doc: unknown, keep: Set<string>): unknown => {
  const d = doc as { meta: Record<string, unknown>; items: Record<string, unknown> };
  return {
    ...d,
    items: Object.fromEntries(Object.entries(d.items).filter(([k]) => keep.has(k))),
  };
};
const keepOperations = (ops: unknown, keep: Set<string>): unknown =>
  (ops as Operation[]).filter((op) => {
    const category = /^\/items\/([^/]+)/.exec(op.path)?.[1];
    return !category || keep.has(category);
  });

// heroes-images' files by name (its folders are the same as HDP's images/ folders)
const tree = JSON.parse(
  execFileSync('gh', ['api', 'repos/HeroesToolChest/heroes-images/git/trees/main?recursive=1'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }),
) as { truncated: boolean; tree: { path: string; type: string }[] };
if (tree.truncated) throw new Error("heroes-images' file list came back truncated");
const imagePath = new Map<string, string>();
for (const { path, type } of tree.tree) {
  const match = /^heroesimages\/([^/]+)\/([^/]+)$/.exec(path);
  if (type === 'blob' && match) imagePath.set(match[2]!.toLowerCase(), `${match[1]}/${match[2]}`);
}

// ── The builds to import: this channel's, older than our own, not imported yet ───────────────

const index = await json<{ versions: string[] }>('', '.version.json');
const done = new Set((await readHistory(channel)).map((m) => m.game));
const wanted = index.versions
  .filter((v) => v.endsWith('_ptr') === (channel === 'ptr'))
  .map((dir) => ({ dir, game: dir.replace(/_ptr$/, '') }))
  .filter(({ game }) => Number(game.split('.').pop()) < latestBuild && !done.has(game))
  .sort((a, b) => Number(b.game.split('.').pop()) - Number(a.game.split('.').pop()));

let oldest: Documents | undefined;
for await (const { docs } of builds(channel)) oldest = docs;

for (const { dir, game } of wanted) {
  const meta = await metaOf(dir);
  if (!meta.extracted) {
    console.log(`${channel} ${game}: not extracted in heroes-data2, skipped`);
    continue;
  }
  const folder = join(CACHE, 'build', dir);
  const files = meta.files as Record<string, Record<string, unknown>>;
  const build = game.split('.').pop()!;
  const write = async (path: string, doc: unknown): Promise<void> => {
    const target = join(folder, path.replace('{build}', build));
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, JSON.stringify(doc));
  };

  const pictures = new Set<string>();
  for (const kind of dataKinds) {
    const doc = await rebuild(dir, 'data', ['[data]', kind]);
    pictureNames(doc, pictures);
    await write(`data/${kind}_{build}.json`, doc);
  }
  for (const [map, kinds] of Object.entries(
    (files['[data]']?.['[maps]'] ?? {}) as Record<string, Record<string, string>>,
  )) {
    for (const [kind, name] of Object.entries(kinds)) {
      if (!mapKinds.has(kind)) continue;
      const doc = await json<unknown>(dir, `data/maps/${map}/${name}`);
      pictureNames(doc, pictures);
      await write(`data/maps/${map}/${kind}_{build}.patch.json`, doc);
    }
  }
  const strings = (files['[gamestrings]'] ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(strings)) {
    if (/^[a-z]{4}$/.test(key)) {
      const doc = await rebuild(dir, 'gamestrings', ['[gamestrings]', key]);
      await write(
        `gamestrings/gamestrings_{build}_${key}.json`,
        keepCategories(doc, stringCategories),
      );
    } else if (/^mapdata\|[a-z]{4}$/.test(key)) {
      const locale = key.split('|')[1];
      const doc = await rebuild(dir, 'gamestrings', ['[gamestrings]', key]);
      await write(
        `gamestrings/gamestrings_mapdata_{build}_${locale}.json`,
        keepCategories(doc, mapStringCategories),
      );
    }
  }
  for (const [map, locales] of Object.entries(
    (strings['[maps]'] ?? {}) as Record<string, Record<string, string>>,
  )) {
    for (const [locale, name] of Object.entries(locales)) {
      const ops = await json<unknown>(dir, `gamestrings/maps/${map}/${name}`);
      await write(
        `gamestrings/maps/${map}/gamestrings_{build}_${locale}.patch.json`,
        keepOperations(ops, stringCategories),
      );
    }
  }

  // the pictures the data names, from heroes-images, a few at a time
  const queue = [...pictures].filter((name) => imagePath.has(name));
  const missing = pictures.size - queue.length;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        const path = imagePath.get(name)!;
        const data = await cached(`${IMAGES}/${path}`, `images/${path}`);
        const target = join(folder, 'images', path);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, data);
      }
    }),
  );

  const docs = await readExtraction(folder, game);
  await appendOlder(channel, oldest!, { game, origin: 'heroes-data2' }, docs);
  oldest = docs;
  console.log(
    `${channel} ${game}: imported (${docs.size} documents, ${pictures.size - missing} pictures` +
      `${missing ? `, ${missing} named but not in heroes-images` : ''})`,
  );
}
