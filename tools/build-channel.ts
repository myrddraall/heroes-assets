// Turns a Heroes Data Parser extraction into a channel's folder: the raw output as it came, plus
// files split for apps (one hero per file, strings per locale) and the pictures as sheets.
//
//   node tools/build-channel.ts <live|ptr> <extraction folder> [output folder]
//
// The output folder is the channel's own (live/, ptr/) unless given: tools/build-history.ts builds
// past builds elsewhere.
//
// The extraction folder is what tools/extract.ts writes for every locale, merged: HDP's data/,
// gamestrings/ and images/, and map-ui/ (each map's interface textures, lib/map-ui.ts).
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { writeAnimatedWebp } from './lib/animated.ts';
import { asChannel, LOCALES, ROOT } from './lib/channels.ts';
import { decodeDds, type Decoded } from './lib/dds.ts';
import { HERO_UNIT_TEXTURES } from './lib/hero-units.ts';
import {
  pictureSize,
  webpName,
  writeScaledWebp,
  writeSheet,
  writeWebp,
  type Picture,
  type Rect,
} from './lib/sheet.ts';

type Json = Record<string, unknown>;
/** HDP's gamestrings: category → field → id → text. */
type GameStrings = Record<string, Record<string, Record<string, string>>>;

const [, , channelArg, hdpArg, outArg] = process.argv;
const channel = asChannel(channelArg);
if (!hdpArg)
  throw new Error('Usage: build-channel.ts <live|ptr> <extraction folder> [output folder]');
const hdp = hdpArg;
const out = outArg ?? join(ROOT, channel);

/** The folders this tool writes in a channel's folder; everything in them is rebuilt each time. */
const GENERATED = [
  'raw',
  'heroes',
  'portraits',
  'emoticons',
  'maps',
  'minimap',
  'awards',
  'strings',
  'pictures.json',
];

/** What the build couldn't do, each said once, with the names it's about for the run's summary. */
const warnings: { message: string; names: readonly string[] }[] = [];
const warn = (message: string, names: readonly string[] = []): void => {
  warnings.push({ message, names });
  console.warn(`warning: ${label}: ${message}`);
};

/** A few names of a list, for a one-line message. */
const some = (names: readonly string[]): string =>
  names.slice(0, 3).join(', ') + (names.length > 3 ? `, and ${names.length - 3} more` : '');

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

/**
 * A sheet of the named pictures that exist (HDP's by file name, or pictures given as they are);
 * the missing ones are warned about.
 */
async function sheet(
  names: Iterable<[string, string | Picture]>,
  pictures: ReadonlyMap<string, string>,
  path: string,
  what: string,
): Promise<Record<string, Rect>> {
  const found = new Map<string, Picture>();
  const missing: string[] = [];
  let total = 0;
  for (const [name, file] of names) {
    total++;
    if (typeof file !== 'string') {
      found.set(name, file);
      continue;
    }
    const picture = pictures.get(file.toLowerCase());
    if (picture) found.set(name, picture);
    else missing.push(file);
  }
  if (missing.length) {
    const result = found.size ? 'left out of it' : 'so there is no sheet';
    warn(
      `${what}: ${missing.length} of the ${total} pictures the data names aren't in the extraction, ${result} (${some(missing)})`,
      missing,
    );
  }
  return found.size ? writeSheet(found, path) : {};
}

/** A file name without its extension: the key a sheet's pictures go by. */
const stem = (file: string): string => file.replace(/\.[^.]+$/, '');

// ── Start clean (raw/ was HDP's output, now kept in sources/ and published by build-site) ────

for (const folder of GENERATED) await rm(join(out, folder), { recursive: true, force: true });

/** Which build this is, for messages: the channel, and the game version the data says. */
const heroDataMeta = await readJson<{ meta: { heroesVersion: string } }>(
  join(
    hdp,
    'data',
    (await readdir(join(hdp, 'data'))).find((n) => /^herodata_\d+\.json$/.test(n))!,
  ),
);
const label = `${channel} ${heroDataMeta.meta.heroesVersion.replace(/_ptr$/, '')}`;

const pictures = await pictureFiles();
const strings = await gameStrings();

// ── Heroes: one file, an ability sheet, a talent sheet and a hero sheet (both, with its
//    portraits) each; portraits also a sheet per kind across heroes ──────────────────────────

type Portraits = Record<string, string | string[]>;

interface Hero extends Json {
  portraits?: Portraits;
  heroUnits?: Record<string, { portraits?: Portraits }>;
  summonedUnitIds?: string[];
}

const heroes = (await dataFile<Hero>('herodata')).items;

/** A portrait's files of one kind: none (''), one, or a list (`partyFrames`). */
const portraitFiles = (portraits: Portraits | undefined, kind: string): string[] =>
  [portraits?.[kind] ?? []].flat().filter((file) => file);

/** An extraction from before hero units' portraits were taken (a past build's) has none of them. */
const hasHeroUnits = await readdir(join(hdp, HERO_UNIT_TEXTURES)).then(
  () => true,
  () => false,
);

/**
 * A hero's picture for its sheet: the extraction's, else a hero unit's texture (HDP writes only
 * the heroes' own portraits; lib/hero-units.ts), else the name (the sheet says it's missing).
 */
async function heroPicture(file: string): Promise<Picture> {
  if (pictures.has(file.toLowerCase())) return file;
  try {
    const texture = `${stem(file).toLowerCase()}.dds`;
    return decodeDds(await readFile(join(hdp, HERO_UNIT_TEXTURES, texture)));
  } catch {
    return file;
  }
}

/** The portraits a hero's own sheet holds besides its icons. */
const HERO_SHEET_PORTRAITS = ['draftScreen', 'minimap', 'partyPanel', 'target', 'targetInfo'];
const heroIndex: Json[] = [];
const heroLinks = new Map<string, { links: Set<string>; units: Set<string> }>();

// the sheets encode in parallel (lib/encode.ts); everything listing them keeps the data's order
await Promise.all(
  Object.entries(heroes).map(async ([id, hero]) => {
    const { portraits: _, ...data } = hero;
    const { talents, ...abilities } = data; // abilities, sub-abilities, hero units' abilities
    const kinds = { abilities: collect(abilities, ['icon']), talents: collect(talents, ['icon']) };
    const sheets: Record<string, Json> = Object.fromEntries(
      await Promise.all(
        Object.entries(kinds).map(async ([kind, icons]) => {
          const file = `${id}/${kind}.webp`;
          const rects = await sheet(
            [...icons].map((icon) => [icon, icon]),
            pictures,
            join(out, 'heroes', 'sheets', file),
            `${id}'s ${kind === 'abilities' ? 'ability' : 'talent'} sheet`,
          );
          const written = Object.keys(rects).length > 0;
          return [kind, { sheet: written ? `sheets/${file}` : null, icons: rects }] as const;
        }),
      ),
    );
    // the hero sheet: every icon by file name, the portraits by kind, the party frames (in
    // order) and the hero units' portraits by unit and kind; a picture used more than once
    // (Anub'arak's The Traitor King is his draft portrait) is in it once
    const portraits = HERO_SHEET_PORTRAITS.flatMap((kind) =>
      portraitFiles(hero.portraits, kind).map((file) => [kind, file] as const),
    );
    const partyFrames = portraitFiles(hero.portraits, 'partyFrames');
    const units = Object.entries(hasHeroUnits ? (hero.heroUnits ?? {}) : {}).map(
      ([unit, { portraits: own }]) =>
        [
          unit,
          Object.keys(own ?? {}).flatMap((kind) =>
            portraitFiles(own, kind).map((file) => [kind, file] as const),
          ),
        ] as const,
    );
    const icons = [...new Set([...kinds.abilities, ...kinds.talents])];
    const files = new Set([
      ...icons,
      ...portraits.map(([, file]) => file),
      ...partyFrames,
      ...units.flatMap(([, own]) => own.map(([, file]) => file)),
    ]);
    const file = `${id}/hero.webp`;
    const rects = await sheet(
      await Promise.all(
        [...files].map(async (f): Promise<[string, Picture]> => [f, await heroPicture(f)]),
      ),
      pictures,
      join(out, 'heroes', 'sheets', file),
      `${id}'s hero sheet`,
    );
    const placed = <T extends string>(pairs: readonly (readonly [T, string])[]) =>
      Object.fromEntries(pairs.flatMap(([key, f]) => (rects[f] ? [[key, rects[f]]] : [])));
    sheets['hero'] = {
      sheet: Object.keys(rects).length ? `sheets/${file}` : null,
      icons: placed(icons.map((icon) => [icon, icon] as const)),
      portraits: placed(portraits),
      // null where the extraction lacks one
      partyFrames: partyFrames.map((f) => rects[f] ?? null),
      units: Object.fromEntries(units.map(([unit, own]) => [unit, placed(own)])),
    };
    await writeJson(join(out, 'heroes', `${id}.json`), { id, ...data, sheets });
  }),
);
for (const [id, hero] of Object.entries(heroes)) {
  const { portraits: _, ...data } = hero;
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
const portraitIndex: Record<string, Json> = Object.fromEntries(
  await Promise.all(
    [...portraitKinds].map(async ([kind, files]) => {
      const path = join(out, 'portraits', `${kind}.webp`);
      const rects = await sheet(files, pictures, path, `the ${kind} portrait sheet`);
      return [kind, { sheet: `${kind}.webp`, heroes: rects }] as const;
    }),
  ),
);
await writeJson(join(out, 'portraits', 'index.json'), portraitIndex);

// ── Emoticons: still ones as a sheet per emote pack ("other" for those in none), animated ones
//    as animated WebPs

interface Emoticon extends Json {
  heroId?: string;
  /** Absent for a few the game lists without a picture. */
  image?: string;
  animation?: { frames: number; duration: number };
}

const emoticons = (await dataFile<Emoticon>('emoticondata')).items;
const packs = (await dataFile<{ emoticonIds?: string[] }>('emoticonpackdata')).items;
const packOf = new Map<string, string>();
for (const [pack, { emoticonIds }] of Object.entries(packs)) {
  for (const id of emoticonIds ?? []) packOf.set(id, pack);
}
const emoticonGroups = new Map<string, [string, string][]>();
for (const [id, emoticon] of Object.entries(emoticons)) {
  if (!emoticon.image) continue;
  const group = packOf.get(id) ?? 'other';
  if (!emoticonGroups.has(group)) emoticonGroups.set(group, []);
  emoticonGroups.get(group)!.push([id, emoticon.image]);
}
const emoticonRects = new Map<string, { sheet: string; rect: Rect }>();
const groupRects = await Promise.all(
  [...emoticonGroups].map(async ([group, images]) => {
    const path = join(out, 'emoticons', 'sheets', `${group}.webp`);
    return [group, await sheet(images, pictures, path, `the ${group} emote sheet`)] as const;
  }),
);
for (const [group, rects] of groupRects) {
  for (const [id, rect] of Object.entries(rects)) {
    emoticonRects.set(id, { sheet: `sheets/${group}.webp`, rect });
  }
}
const animatedFiles = new Map<string, string>();
const missingAnimations: string[] = [];
await Promise.all(
  Object.entries(emoticons).map(async ([id, { image, animation }]) => {
    if (!animation || !image) return;
    const picture = pictures.get(image.toLowerCase());
    if (!picture) return void missingAnimations.push(image);
    await writeAnimatedWebp(picture, join(out, 'emoticons', 'animated', webpName(image)));
    animatedFiles.set(id, `animated/${webpName(image)}`);
  }),
);
if (missingAnimations.length) {
  warn(
    `${missingAnimations.length} animated emotes aren't in the extraction, so they show still (${some(missingAnimations.sort())})`,
    missingAnimations,
  );
}
const emoticonIndex: Record<string, Json> = {};
for (const [id, emoticon] of Object.entries(emoticons)) {
  const { image, animation, ...data } = emoticon;
  const file = animatedFiles.get(id);
  const animated = file &&
    animation && { file, frames: animation.frames, duration: animation.duration };
  emoticonIndex[id] = {
    id,
    ...data,
    pack: packOf.get(id) ?? null,
    ...emoticonRects.get(id),
    ...(animated && { animated }),
  };
}
await writeJson(join(out, 'emoticons', 'index.json'), { emoticons: emoticonIndex, packs });

// ── Maps: their data by normalized id; previews and loading screens as WebPs, and a sheet each
//    of the map's objective icons and the interface textures its mods name (lib/map-ui.ts) ────

interface MapData extends Json {
  normalizedId: string;
}

/** The pictures that stay files of their own (large; one per map). */
const MAP_FILES = ['replayPreviewImage', 'loadingScreenImage'];

/** An interface texture bigger than this either way (a home-screen background) gets its own file. */
const SHEET_MAX = 512;

/** A map's data with its pictures renamed: files to their WebP, objective icons to their key. */
function renamed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renamed);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      typeof v !== 'string'
        ? renamed(v)
        : MAP_FILES.includes(key)
          ? `images/${webpName(v)}`
          : key === 'image'
            ? stem(v)
            : v,
    ]),
  );
}

const maps = (await dataFile<MapData>('mapdata')).items;
let mapUi: { maps: Record<string, string[]> } = { maps: {} };
try {
  mapUi = await readJson(join(hdp, 'map-ui', 'maps.json'));
} catch {
  warn(
    'the extraction has no map interface textures (map-ui/maps.json), so map sheets hold only the objective icons',
  );
}
const textures = new Map<string, Decoded | null>();
async function texture(name: string): Promise<Decoded | null> {
  if (!textures.has(name)) {
    try {
      textures.set(name, decodeDds(await readFile(join(hdp, 'map-ui', 'textures', `${name}.dds`))));
    } catch (error) {
      // named by a mod but not in the game (gatherTextures listed it), or not decodable
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        warn(`the map texture ${name}.dds couldn't be decoded, so it's left out (${error})`);
      }
      textures.set(name, null);
    }
  }
  return textures.get(name)!;
}

// Most replay previews are one size (417×234): the few that aren't (Sandbox Cursed Hollow's
// 574×348, Snow Brawl's 418×234, some builds' full-screen ones) are scaled to it, and a map
// without one (Deadman's Stand) gets its loading screen scaled to it
const previewSizes = new Map<string, number>();
for (const map of Object.values(maps)) {
  const file = typeof map['replayPreviewImage'] === 'string' ? map['replayPreviewImage'] : '';
  const picture = pictures.get(file.toLowerCase());
  if (!picture) continue;
  const { width, height } = await pictureSize(picture);
  previewSizes.set(`${width}x${height}`, (previewSizes.get(`${width}x${height}`) ?? 0) + 1);
}
const [previewSize] = [...previewSizes].sort((a, b) => b[1] - a[1])[0] ?? [];
const [previewWidth, previewHeight] = (previewSize ?? '').split('x').map(Number);
const isPreviewSize = async (picture: string): Promise<boolean> => {
  const { width, height } = await pictureSize(picture);
  return `${width}x${height}` === previewSize;
};

const mapIndex: Record<string, Json> = {};
await Promise.all(
  Object.entries(maps).map(async ([key, map]) => {
    for (const file of collect(map, MAP_FILES)) {
      const picture = pictures.get(file.toLowerCase());
      const target = join(out, 'maps', 'images', webpName(file));
      if (!picture)
        warn(`${key}'s ${file} isn't in the extraction, so the map has no such picture`);
      else if (file === map['replayPreviewImage'] && previewSize && !(await isPreviewSize(picture)))
        await writeScaledWebp(picture, target, previewWidth!, previewHeight!);
      else await writeWebp(picture, target);
    }
    const entries: [string, string | Picture][] = [...collect(map, ['image'])].map((file) => [
      stem(file),
      file,
    ]);
    const images: Record<string, string> = {};
    for (const name of mapUi.maps[key] ?? []) {
      const decoded = await texture(name);
      if (!decoded) continue;
      if (decoded.width <= SHEET_MAX && decoded.height <= SHEET_MAX) {
        entries.push([name, decoded]);
        continue;
      }
      images[name] = `images/${name}.webp`;
      await writeWebp(
        { raw: decoded.pixels, width: decoded.width, height: decoded.height },
        join(out, 'maps', images[name]),
      );
    }
    const file = `sheets/${map.normalizedId}.webp`;
    const icons = await sheet(entries, pictures, join(out, 'maps', file), `${key}'s map sheet`);
    mapIndex[map.normalizedId] = {
      id: map.normalizedId,
      key,
      ...(renamed(map) as Json),
      // null when the map has no icons to show (no sheet written)
      sheet: Object.keys(icons).length ? file : null,
      icons,
      images,
    };
  }),
);
await Promise.all(
  Object.entries(maps).map(async ([key, map]) => {
    const preview = typeof map['replayPreviewImage'] === 'string' ? map['replayPreviewImage'] : '';
    if (pictures.has(preview.toLowerCase())) return;
    const loading = typeof map['loadingScreenImage'] === 'string' ? map['loadingScreenImage'] : '';
    const picture = pictures.get(loading.toLowerCase());
    if (!picture || !previewWidth || !previewHeight) {
      return warn(`${key} has no replay preview, nor a loading screen to make one from`);
    }
    const file = `images/${map.normalizedId}-preview.webp`;
    await writeScaledWebp(picture, join(out, 'maps', file), previewWidth, previewHeight);
    mapIndex[map.normalizedId]!['replayPreviewImage'] = file;
  }),
);

await writeJson(
  join(out, 'maps', 'index.json'),
  Object.fromEntries(Object.values(maps).map((m) => [m.normalizedId, mapIndex[m.normalizedId]])),
);

// ── Minimap icons: every unit's that has one (towers, camps, tributes, shrines, summons…),
//    a sheet keyed by unit. Shared by every map; no map's own data claims them ────────────────

const units = (await dataFile<{ portraits?: { minimap?: string } }>('unitdata')).items;
const minimapIcons = Object.entries(units).flatMap(([id, unit]) =>
  unit.portraits?.minimap ? [[id, unit.portraits.minimap] as [string, string]] : [],
);
const minimapRects = await sheet(
  minimapIcons,
  pictures,
  join(out, 'minimap', 'units.webp'),
  'the minimap icon sheet',
);
await writeJson(join(out, 'minimap', 'index.json'), {
  sheet: Object.keys(minimapRects).length ? 'units.webp' : null,
  units: minimapRects,
});

// ── Match awards: the MVP screen's icons (blue, red, gold) and the score screen's (blue, red) ─

interface Award {
  mvpScreenIcon?: string;
  scoreScreenIcon?: string;
}

const awards = await dataFile<Award>('matchawarddata')
  .then((file) => file.items)
  .catch(() => ({}) as Record<string, Award>); // builds imported before awards were extracted
const awardFiles = Object.values(awards).flatMap(({ mvpScreenIcon, scoreScreenIcon }) => [
  ...(mvpScreenIcon ? ['blue', 'red', 'gold'].map((c) => mvpScreenIcon.replace('%color%', c)) : []),
  ...(scoreScreenIcon ? ['blue', 'red'].map((c) => scoreScreenIcon.replace('%team%', c)) : []),
]);
const awardRects = await sheet(
  awardFiles.map((file): [string, string] => [file, file]),
  pictures,
  join(out, 'awards', 'awards.webp'),
  'the award sheet',
);
await writeJson(join(out, 'awards', 'index.json'), {
  sheet: Object.keys(awardRects).length ? 'awards.webp' : null,
  icons: awardRects,
});

// ── pictures.json: every picture the game data names, by its file name there, and where it is:
//    a sheet (with the place in it and the sheet's size) or a file of its own. Paths are from
//    the channel's folder. A picture in several sheets is given once, in the first of: portrait
//    sheets, hero sheets, the minimap sheet, the awards sheet, emote sheets, map sheets ────────

type Place =
  | { readonly sheet: string; readonly rect: Rect; readonly size: readonly [number, number] }
  | { readonly file: string };
const places = new Map<string, Place>();
const sheetSizes = new Map<string, Promise<readonly [number, number]>>();
const sizeOf = (sheet: string): Promise<readonly [number, number]> => {
  if (!sheetSizes.has(sheet)) {
    sheetSizes.set(
      sheet,
      pictureSize(join(out, sheet)).then(({ width, height }) => [width, height] as const),
    );
  }
  return sheetSizes.get(sheet)!;
};
async function place(file: string | undefined, sheet: string | null, rect?: Rect): Promise<void> {
  const name = file?.toLowerCase();
  if (!name || places.has(name) || !sheet || !rect) return;
  places.set(name, { sheet, rect, size: await sizeOf(sheet) });
}

for (const [kind, { sheet: file, heroes: rects }] of Object.entries(portraitIndex) as [
  string,
  { sheet: string; heroes: Record<string, Rect> },
][]) {
  for (const [id, rect] of Object.entries(rects)) {
    await place(heroes[id]?.portraits?.[kind] as string | undefined, `portraits/${file}`, rect);
  }
}
for (const id of Object.keys(heroes)) {
  const { sheets } = await readJson<{
    sheets: {
      hero: {
        sheet: string | null;
        icons: Record<string, Rect>;
        portraits: Record<string, Rect>;
        partyFrames: (Rect | null)[];
        units: Record<string, Record<string, Rect>>;
      };
    };
  }>(join(out, 'heroes', `${id}.json`));
  const hero = heroes[id]!;
  const sheet = sheets.hero.sheet && `heroes/${sheets.hero.sheet}`;
  for (const [file, rect] of Object.entries(sheets.hero.icons)) await place(file, sheet, rect);
  for (const [kind, rect] of Object.entries(sheets.hero.portraits)) {
    await place(portraitFiles(hero.portraits, kind)[0], sheet, rect);
  }
  const partyFrames = portraitFiles(hero.portraits, 'partyFrames');
  for (const [i, rect] of sheets.hero.partyFrames.entries()) {
    await place(partyFrames[i], sheet, rect ?? undefined);
  }
  for (const [unit, own] of Object.entries(sheets.hero.units)) {
    for (const [kind, rect] of Object.entries(own)) {
      await place(portraitFiles(hero.heroUnits?.[unit]?.portraits, kind)[0], sheet, rect);
    }
  }
}
for (const [id, rect] of Object.entries(minimapRects)) {
  await place(units[id]?.portraits?.minimap, 'minimap/units.webp', rect);
}
for (const [file, rect] of Object.entries(awardRects))
  await place(file, 'awards/awards.webp', rect);
for (const [id, emoticon] of Object.entries(emoticonIndex) as [string, Json][]) {
  const image = emoticons[id]?.image?.toLowerCase();
  const animated = emoticon['animated'] as { file: string } | undefined;
  if (image && animated && !places.has(image)) {
    places.set(image, { file: `emoticons/${animated.file}` });
  } else if (typeof emoticon['sheet'] === 'string') {
    await place(image, `emoticons/${emoticon['sheet']}`, emoticon['rect'] as Rect);
  }
}
const mapPictures: Record<string, { replayPreview?: string; loadingScreen?: string }> = {};
for (const map of Object.values(maps)) {
  const entry = mapIndex[map.normalizedId]!;
  const icons = entry['icons'] as Record<string, Rect>;
  for (const file of collect(map, ['image'])) {
    await place(file, entry['sheet'] ? `maps/${entry['sheet']}` : null, icons[stem(file)]);
  }
  for (const [field, kind] of [
    ['replayPreviewImage', 'replayPreview'],
    ['loadingScreenImage', 'loadingScreen'],
  ] as const) {
    const built = entry[field];
    if (typeof built !== 'string') continue;
    const original = map[field];
    if (typeof original === 'string' && !places.has(original.toLowerCase())) {
      places.set(original.toLowerCase(), { file: `maps/${built}` });
    }
    (mapPictures[map.normalizedId] ??= {})[kind] = `maps/${built}`;
  }
}
await writeJson(join(out, 'pictures.json'), {
  files: Object.fromEntries([...places].sort(([a], [b]) => a.localeCompare(b))),
  maps: mapPictures,
});

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
    `${Object.keys(emoticonIndex).length} emoticons in ${emoticonGroups.size} sheets, ` +
    `${Object.keys(mapIndex).length} maps, ${Object.keys(minimapRects).length} minimap icons, ` +
    `${strings.size} locales, ${warnings.length} warnings`,
);
if (process.env['GITHUB_STEP_SUMMARY'] && warnings.length) {
  const lines = warnings.map(({ message, names }) =>
    names.length > 3
      ? `- ${message}\n  <details><summary>All ${names.length}</summary>\n\n  ${names.join(', ')}\n  </details>`
      : `- ${message}`,
  );
  await writeFile(
    process.env['GITHUB_STEP_SUMMARY'],
    `### ${label}: ${warnings.length} warning${warnings.length === 1 ? '' : 's'}\n\n${lines.join('\n')}\n`,
    { flag: 'a' },
  );
}
