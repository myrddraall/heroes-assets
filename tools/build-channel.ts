// Turns a Heroes Data Parser extraction into a channel's folder: the raw output as it came, plus
// files split for apps (one hero per file, strings per locale) and the pictures as sheets.
//
//   node tools/build-channel.ts <live|ptr> <hdp output folder>
//
// The HDP output folder is what `heroesdataparser online -e hero:i -e unit -e emoticon:i
// -e emoticonpack -e map:i -l all --localized-text Extract --gs-… -o <folder>` writes: data/,
// gamestrings/ and images/ (update.yml has the full command).
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { writeAnimatedWebp } from './lib/animated.ts';
import { asChannel, LOCALES, ROOT } from './lib/channels.ts';
import { webpName, writeSheet, writeWebp, type Rect } from './lib/sheet.ts';

type Json = Record<string, unknown>;
/** HDP's gamestrings: category → field → id → text. */
type GameStrings = Record<string, Record<string, Record<string, string>>>;

const [, , channelArg, hdpArg] = process.argv;
const channel = asChannel(channelArg);
if (!hdpArg) throw new Error('Usage: build-channel.ts <live|ptr> <hdp output folder>');
const hdp = hdpArg;
const out = join(ROOT, channel);

/** The folders this tool writes in a channel's folder; everything in them is rebuilt each time. */
const GENERATED = ['raw', 'heroes', 'portraits', 'emoticons', 'maps', 'strings'];

const warnings: string[] = [];
const warn = (message: string): void => {
  warnings.push(message);
  console.warn(`warning: ${message}`);
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** The one data file of a kind (`herodata`) at the top of HDP's data folder. */
async function dataFile<T>(kind: string): Promise<{ items: Record<string, T> }> {
  const names = await readdir(join(hdp, 'data'));
  const name = names.find((n) => new RegExp(`^${kind}_\\d+\\.json$`).test(n));
  if (!name) throw new Error(`No ${kind} file in ${join(hdp, 'data')}: ${names.join(', ')}`);
  return readJson(join(hdp, 'data', name));
}

/** Each locale's gamestrings files (the main one and the maps'), by HDP's locale name. */
async function gameStrings(): Promise<Map<string, { main: GameStrings; maps: GameStrings }>> {
  const folder = join(hdp, 'gamestrings');
  const names = await readdir(folder);
  const byLocale = new Map<string, { main: GameStrings; maps: GameStrings }>();
  for (const locale of Object.keys(LOCALES)) {
    const main = names.find((n) => new RegExp(`^gamestrings_\\d+_${locale}\\.json$`).test(n));
    const maps = names.find((n) =>
      new RegExp(`^gamestrings_mapdata_\\d+_${locale}\\.json$`).test(n),
    );
    if (!main) throw new Error(`No ${locale} gamestrings in ${folder}`);
    byLocale.set(locale, {
      main: (await readJson<{ items: GameStrings }>(join(folder, main))).items,
      maps: maps ? (await readJson<{ items: GameStrings }>(join(folder, maps))).items : {},
    });
  }
  return byLocale;
}

/** Every picture HDP extracted, by file name (HDP's folders per kind don't matter here). */
async function pictureFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const path of walk(join(hdp, 'images'))) files.set(basename(path).toLowerCase(), path);
  return files;
}

/** The texts of a category for some ids, by id then field: `{ id: { name, shortText } }`. */
function stringsOf(
  strings: GameStrings,
  category: string,
  ids: Iterable<string>,
): Record<string, Record<string, string>> {
  const fields = strings[category] ?? {};
  const result: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    for (const [field, texts] of Object.entries(fields)) {
      const text = texts[id];
      if (text !== undefined) (result[id] ??= {})[field] = text;
    }
  }
  return result;
}

/** Every value of some keys anywhere in a hero's data (icons, link ids). */
function collect(value: unknown, keys: readonly string[], into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collect(v, keys, into));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (keys.includes(key) && typeof v === 'string') into.add(v);
      else collect(v, keys, into);
    }
  }
  return into;
}

/** A sheet of the named pictures that exist; the missing ones are warned about. */
async function sheet(
  names: Iterable<[string, string]>,
  pictures: ReadonlyMap<string, string>,
  path: string,
  what: string,
): Promise<Record<string, Rect>> {
  const found = new Map<string, string>();
  for (const [name, file] of names) {
    const picture = pictures.get(file.toLowerCase());
    if (picture) found.set(name, picture);
    else warn(`${what}: no picture ${file}`);
  }
  return found.size ? writeSheet(found, path) : {};
}

// ── Start clean, keep the raw output ─────────────────────────────────────────────────────────

for (const folder of GENERATED) await rm(join(out, folder), { recursive: true, force: true });
await cp(join(hdp, 'data'), join(out, 'raw', 'data'), { recursive: true });
await cp(join(hdp, 'gamestrings'), join(out, 'raw', 'gamestrings'), { recursive: true });

const pictures = await pictureFiles();
const strings = await gameStrings();

// ── Heroes: one file and one ability/talent sheet each, portraits as one sheet per kind ──────

interface Hero extends Json {
  portraits?: Record<string, string | string[]>;
  heroUnits?: Record<string, unknown>;
  summonedUnitIds?: string[];
}

const heroes = (await dataFile<Hero>('herodata')).items;
const heroIndex: Json[] = [];
const heroLinks = new Map<string, { links: Set<string>; units: Set<string> }>();

for (const [id, hero] of Object.entries(heroes)) {
  const { portraits: _, ...data } = hero;
  const icons = collect(data, ['icon']);
  const rects = await sheet(
    [...icons].map((icon) => [icon, icon]),
    pictures,
    join(out, 'heroes', 'sheets', `${id}.webp`),
    id,
  );
  await writeJson(join(out, 'heroes', `${id}.json`), {
    id,
    ...data,
    sheet: `sheets/${id}.webp`,
    icons: rects,
  });
  heroLinks.set(id, {
    links: collect(data, ['linkId']),
    units: new Set([...Object.keys(hero.heroUnits ?? {}), ...(hero.summonedUnitIds ?? [])]),
  });
  const { abilities, subAbilities, talents, heroUnits, weapons, ...summary } = data;
  heroIndex.push({ id, ...summary });
}
await writeJson(join(out, 'heroes', 'index.json'), heroIndex);

const portraitKinds = new Map<string, Map<string, string>>();
for (const [id, hero] of Object.entries(heroes)) {
  for (const [kind, file] of Object.entries(hero.portraits ?? {})) {
    // partyFrames is a list (its first is targetInfo); a hero without a portrait of a kind has ''
    if (typeof file !== 'string' || !file) continue;
    if (!portraitKinds.has(kind)) portraitKinds.set(kind, new Map());
    portraitKinds.get(kind)!.set(id, file);
  }
}
const portraitIndex: Record<string, Json> = {};
for (const [kind, files] of portraitKinds) {
  const rects = await sheet(files, pictures, join(out, 'portraits', `${kind}.webp`), kind);
  portraitIndex[kind] = { sheet: `${kind}.webp`, heroes: rects };
}
await writeJson(join(out, 'portraits', 'index.json'), portraitIndex);

// ── Emoticons: still ones as a sheet per hero (or "universal"), animated ones as animated WebPs

interface Emoticon extends Json {
  heroId?: string;
  /** Absent for a few the game lists without a picture. */
  image?: string;
  animation?: { frames: number; duration: number };
}

const emoticons = (await dataFile<Emoticon>('emoticondata')).items;
const packs = (await dataFile<Json>('emoticonpackdata')).items;
const emoticonGroups = new Map<string, [string, string][]>();
for (const [id, emoticon] of Object.entries(emoticons)) {
  if (!emoticon.image) continue;
  const group = (emoticon.heroId ?? 'universal').toLowerCase();
  if (!emoticonGroups.has(group)) emoticonGroups.set(group, []);
  emoticonGroups.get(group)!.push([id, emoticon.image]);
}
const emoticonRects = new Map<string, { sheet: string; rect: Rect }>();
for (const [group, images] of emoticonGroups) {
  const rects = await sheet(
    images,
    pictures,
    join(out, 'emoticons', 'sheets', `${group}.webp`),
    group,
  );
  for (const [id, rect] of Object.entries(rects)) {
    emoticonRects.set(id, { sheet: `sheets/${group}.webp`, rect });
  }
}
const emoticonIndex: Record<string, Json> = {};
for (const [id, emoticon] of Object.entries(emoticons)) {
  const { image, animation, ...data } = emoticon;
  let animated: Json | undefined;
  if (animation && image) {
    const picture = pictures.get(image.toLowerCase());
    if (picture) {
      await writeAnimatedWebp(picture, join(out, 'emoticons', 'animated', webpName(image)));
      animated = {
        file: `animated/${webpName(image)}`,
        frames: animation.frames,
        duration: animation.duration,
      };
    } else warn(`${id}: no picture ${image}`);
  }
  emoticonIndex[id] = { id, ...data, ...emoticonRects.get(id), ...(animated && { animated }) };
}
await writeJson(join(out, 'emoticons', 'index.json'), { emoticons: emoticonIndex, packs });

// ── Maps: their data by normalized id, their pictures as WebPs (the data naming those) ──────

interface MapData extends Json {
  normalizedId: string;
}

const MAP_PICTURES = ['replayPreviewImage', 'loadingScreenImage', 'image'];

/** A map's data with each picture it names renamed to its WebP. */
function withWebpNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withWebpNames);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      MAP_PICTURES.includes(key) && typeof v === 'string' ? webpName(v) : withWebpNames(v),
    ]),
  );
}

const maps = (await dataFile<MapData>('mapdata')).items;
const mapIndex: Record<string, Json> = {};
for (const [key, map] of Object.entries(maps)) {
  for (const file of collect(map, MAP_PICTURES)) {
    const picture = pictures.get(file.toLowerCase());
    if (!picture) {
      warn(`${key}: no picture ${file}`);
      continue;
    }
    await writeWebp(picture, join(out, 'maps', 'images', webpName(file)));
  }
  mapIndex[map.normalizedId] = { id: map.normalizedId, key, ...(withWebpNames(map) as Json) };
}
await writeJson(join(out, 'maps', 'index.json'), mapIndex);

// ── Strings, per locale ─────────────────────────────────────────────────────────────────────

for (const [locale, { main, maps: mapStrings }] of strings) {
  const folder = join(out, 'strings', LOCALES[locale]!);
  await writeJson(join(folder, 'heroes.json'), stringsOf(main, 'hero', Object.keys(heroes)));
  for (const [id, { links, units }] of heroLinks) {
    await writeJson(join(folder, 'heroes', `${id}.json`), {
      abilities: stringsOf(main, 'ability', links),
      talents: stringsOf(main, 'talent', links),
      units: stringsOf(main, 'unit', units),
    });
  }
  await writeJson(join(folder, 'emoticons.json'), {
    emoticons: stringsOf(main, 'emoticon', Object.keys(emoticons)),
    packs: stringsOf(main, 'emoticonPack', Object.keys(packs)),
  });
  const byKey = stringsOf(mapStrings, 'map', Object.keys(maps));
  await writeJson(
    join(folder, 'maps.json'),
    Object.fromEntries(
      Object.entries(byKey).map(([key, texts]) => [maps[key]!.normalizedId, texts]),
    ),
  );
}

console.log(
  `${channel}: ${heroIndex.length} heroes, ${portraitKinds.size} portrait sheets, ` +
    `${Object.keys(emoticonIndex).length} emoticons, ${Object.keys(mapIndex).length} maps, ` +
    `${strings.size} locales, ${warnings.length} warnings`,
);
if (process.env['GITHUB_STEP_SUMMARY'] && warnings.length) {
  await writeFile(
    process.env['GITHUB_STEP_SUMMARY'],
    `### ${channel}: ${warnings.length} warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n`,
    { flag: 'a' },
  );
}
