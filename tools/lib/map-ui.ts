// Which interface textures belong to which map, from the game's own data. Each map's .s2mv in the
// depot cache (JSON) gives its title, the one HDP's map data uses, and the mods it's built on
// (Cursed Hollow → cursedhollow.stormmod), as Heroes.XmlData reads them; each of those mods'
// DocumentInfo lists the mods it depends on in turn (Infernal Shrines → infernalshrinesdata →
// heavenhell). A map's interface is every texture those mods name in their catalogs (XML),
// trigger scripts (Galaxy) and layouts: the minimap icons, HUD pieces and target portraits its
// mechanics show. Units shared by every map (towers, camps, tributes) are in no map's mods; their
// minimap icons come with HDP's unit data instead.
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Where the game keeps map and brawl mods. */
const MOD_ROOTS = ['mods/heroesmapmods', 'mods/heroesbrawlmods'];

/** Where the game keeps its maps' descriptions. */
const DEPOT_CACHE = 'mods/core.stormmod/base.stormdata/depotcache';

/** The files to extract (casc-extract globs) to know each map's mods and the textures they name. */
export const MAP_TEXT_PATTERNS = [
  `${DEPOT_CACHE}/**/*.s2mv`,
  ...MOD_ROOTS.flatMap((root) => [
    `${root}/**/documentinfo`,
    `${root}/**/*.xml`,
    `${root}/**/*.galaxy`,
    `${root}/**/*.stormlayout`,
  ]),
];

/**
 * Catalogs whose textures are the map's ground and models, not its interface: terrain and cliff
 * textures (1024×1024 each, with their normal maps) and model texture overrides.
 */
const NOT_INTERFACE = new Set([
  'terraindata.xml',
  'terraintexdata.xml',
  'cliffdata.xml',
  'texturedata.xml',
]);

/** The glob that finds a named texture wherever a mod keeps it. */
export const texturePattern = (name: string): string => `**/assets/textures/${name}.dds`;

interface Mod {
  /** The mods it depends on, by folder name without `.stormmod`. */
  dependencies: string[];
  /** The textures it names, by file name without `.dds`, lower case. */
  textures: Set<string>;
}

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** A mod's folder name without `.stormmod`, lower case, from a path or a dependency. */
const modName = (path: string): string | undefined =>
  /([^/\\:]+)\.stormmod$/i.exec(path.trim())?.[1]?.toLowerCase();

/**
 * Each map's own mods, by its English title, from the .s2mv files of an extraction: those with a
 * MapInfo, the game's maps (the mods' own .s2mv have none); the maps HDP lists in its map data.
 */
export async function readMaps(root: string): Promise<Map<string, string[]>> {
  const maps = new Map<string, string[]>();
  for await (const path of walk(root)) {
    if (!path.toLowerCase().endsWith('.s2mv')) continue;
    const text = await readFile(path, 'utf8');
    if (!text.startsWith('{')) continue;
    const info = JSON.parse(text);
    const title = info?.UsedStrings?.['DocInfo/Name']?.enUS;
    const dependencies = info?.DocInfo?.Dependencies;
    if (typeof title !== 'string' || !Array.isArray(dependencies) || !info.MapInfo) continue;
    const mods = dependencies
      .map((d: { LocalFile?: string }) => modName(d.LocalFile ?? ''))
      .filter((name: string | undefined): name is string => !!name);
    maps.set(title, mods);
  }
  return maps;
}

/**
 * Every map and brawl mod in an extraction of MAP_TEXT_PATTERNS, by folder name without
 * `.stormmod`. Other mods the folder holds (the base data's, for map units) are no map's own.
 */
export async function readMods(root: string): Promise<Map<string, Mod>> {
  const mods = new Map<string, Mod>();
  for await (const path of walk(root)) {
    if (path.toLowerCase().endsWith('.s2mv')) continue;
    const normal = path.replace(/\\/g, '/').toLowerCase();
    if (!MOD_ROOTS.some((r) => normal.includes(`/${r}/`))) continue;
    const match = /([^/]+)\.stormmod\//.exec(normal);
    if (!match) continue;
    const name = match[1]!;
    if (!mods.has(name)) mods.set(name, { dependencies: [], textures: new Set() });
    const mod = mods.get(name)!;
    const text = await readFile(path, 'utf8');
    const file = basename(path).toLowerCase();
    if (file === 'documentinfo') {
      for (const [, value] of text.matchAll(/<Value>([^<]*)<\/Value>/g)) {
        const dependency = modName(value!);
        if (dependency) mod.dependencies.push(dependency);
      }
    } else if (!NOT_INTERFACE.has(file)) {
      for (const [, texture] of text.toLowerCase().matchAll(/([a-z0-9_\-]+)\.dds/g)) {
        mod.textures.add(texture!);
      }
    }
  }
  return mods;
}

/**
 * Each map's interface textures (sorted), by HDP's map name: the textures its own mods and every
 * map or brawl mod they depend on name. Maps without a .s2mv are left out.
 */
export function mapTextures(
  maps: ReadonlyMap<string, readonly string[]>,
  mods: ReadonlyMap<string, Mod>,
  titles: readonly string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const title of titles) {
    const own = maps.get(title);
    if (!own) continue;
    const seen = new Set<string>();
    const textures = new Set<string>();
    const visit = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const mod = mods.get(name);
      if (!mod) return; // HeroesData and the other shared mods aren't map mods
      mod.textures.forEach((t) => textures.add(t));
      mod.dependencies.forEach(visit);
    };
    own.forEach(visit);
    result[title] = [...textures].sort();
  }
  return result;
}

/**
 * Copies the named textures out of an extraction of their texturePattern()s into `out` as
 * `<name>.dds`; returns the names not found.
 */
export async function gatherTextures(
  root: string,
  names: Iterable<string>,
  out: string,
): Promise<string[]> {
  const found = new Map<string, string>();
  for await (const path of walk(root)) {
    const name = basename(path).toLowerCase();
    if (name.endsWith('.dds') && !found.has(name)) found.set(name, path);
  }
  await mkdir(out, { recursive: true });
  const missing: string[] = [];
  for (const name of names) {
    const path = found.get(`${name}.dds`);
    if (path) await copyFile(path, join(out, `${name}.dds`));
    else missing.push(name);
  }
  return missing;
}
