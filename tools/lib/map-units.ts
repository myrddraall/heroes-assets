// Each map's camps and the units a unit card shows (camp defenders and the mercenaries a capture
// sends into lane, towns' structures, cores), from the game's own data, as the map loads it: the
// base data (heroesdata.stormmod) and then the map's mods in their dependency order, the later
// winning.
//
// - Camp types come from the trigger scripts (Galaxy): the map mechanics library defines the
//   shared ones (Siege Giants, Knights, Grave Golem, Doubloons), and helpers it has
//   (libMapM_gf_Initialize<Kind>MercType) that the maps' own libraries call with their label
//   (Infernal Shrines' Impalers, Braxis Holdout's Hellbats). Each sets the camp's defenders, the
//   mercenaries its capture sends, its respawn time, its capture XP, and the scaling behaviours
//   of both; a shared one also its level by rank (lv_campLevel).
// - A unit's portraits are its actor's GroupIcon images, one per team where the map has two
//   (Order's first: Infernal Shrines' Heaven and Hell forts, Alterac Pass' Alliance and Horde).
// - Scaling: every 60 seconds of game time from the gates opening the game counts a scaling tick
//   (libGame_gv_scalingTicks, at most libCore_gv_dataScalingMaxScalingTicks); a camp's defenders
//   are brought to min(ticks, their ranks) while the camp is idle, and the mercenaries its capture
//   sends start at the camp's merc rank then. A rank is a level of the unit's veterancy behaviour
//   (CBehaviorVeterancy): its stats are its base ones plus every level's modification up to it.
// - Names and descriptions (Unit/Name/…, the actor's InfoText) and camp labels (Param/Value/…)
//   in every locale, from the base data's strings and then the map mods'.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The files map units need beyond the map mods' text (MAP_TEXT_PATTERNS in map-ui.ts). */
export const MAP_UNIT_PATTERNS = [
  'mods/heroesdata.stormmod/base.stormdata/gamedata/**/*.xml',
  'mods/heroesdata.stormmod/base.stormdata/triggerlibs/*.galaxy',
  'mods/heroesdata.stormmod/*.stormdata/localizeddata/gamestrings.txt',
  'mods/heroesmapmods/**/localizeddata/gamestrings.txt',
  'mods/heroesbrawlmods/**/localizeddata/gamestrings.txt',
];

/** Bumped when what map units extracts changes. */
export const MAP_UNITS_VERSION = 1;

/** The mod every map loads first. */
const BASE_MOD = 'heroesdata';

/** The units of towns and cores a card shows, besides the camps' (walls, gates and the rest). */
const STRUCTURE = /^(Town[A-Za-z0-9]+|KingsCore|VanndarStormpike|DrekThar)$/;

// ── Reading an extraction ───────────────────────────────────────────────────────────────────────

/** A mod's files of each kind, as an extraction of the patterns holds them. */
interface ModText {
  dependencies: string[];
  xml: string[];
  galaxy: string[];
  /** Its strings, by the game's locale folder name (`enus`). */
  strings: Map<string, string>;
}

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** A mod's folder name without `.stormmod`, lower case. */
const modName = (path: string): string | undefined =>
  /([^/\\:]+)\.stormmod$/i.exec(path.trim())?.[1]?.toLowerCase();

/** Every mod's text in an extraction of MAP_TEXT_PATTERNS and MAP_UNIT_PATTERNS. */
export async function readModTexts(root: string): Promise<Map<string, ModText>> {
  const mods = new Map<string, ModText>();
  for await (const path of walk(root)) {
    const normal = path.replace(/\\/g, '/').toLowerCase();
    const match = /([^/]+)\.stormmod\/(.*)$/.exec(normal);
    if (!match || normal.endsWith('.s2mv')) continue;
    const [, name, rest] = match as unknown as [string, string, string];
    if (!mods.has(name))
      mods.set(name, { dependencies: [], xml: [], galaxy: [], strings: new Map() });
    const mod = mods.get(name)!;
    const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
    if (rest === 'documentinfo') {
      for (const [, value] of text.matchAll(/<Value>([^<]*)<\/Value>/g)) {
        const dependency = modName(value!);
        if (dependency) mod.dependencies.push(dependency);
      }
    } else if (rest.endsWith('.xml') && rest.includes('gamedata/')) mod.xml.push(text);
    else if (rest.endsWith('.galaxy')) mod.galaxy.push(text);
    else if (rest.endsWith('localizeddata/gamestrings.txt')) {
      const locale = /^([a-z]{4})\.stormdata\//.exec(rest)?.[1];
      if (locale) mod.strings.set(locale, text);
    }
  }
  return mods;
}

/**
 * The mods a map loads, in load order: the base data first, then each of the map's own mods after
 * the mods it depends on.
 */
export function loadOrder(own: readonly string[], mods: ReadonlyMap<string, ModText>): string[] {
  const order: string[] = [BASE_MOD];
  const visit = (name: string): void => {
    if (order.includes(name)) return;
    for (const dependency of mods.get(name)?.dependencies ?? []) visit(dependency);
    if (mods.has(name)) order.push(name);
  };
  own.forEach(visit);
  return order;
}

// ── Catalogs: actors (portraits, descriptions) and veterancy (scaling) ─────────────────────────

/** An element's attribute. */
const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Every `<tag …>…</tag>` and `<tag …/>` of a kind (`CActorUnit`), with its opening tag and body. */
function* elements(xml: string, kind: string): Generator<{ open: string; body: string }> {
  const pattern = new RegExp(`<${kind}\\b[^>]*?(/>|>)`, 'g');
  for (const match of xml.matchAll(pattern)) {
    const open = match[0];
    if (match[1] === '/>') {
      yield { open, body: '' };
      continue;
    }
    const start = match.index! + open.length;
    const end = xml.indexOf(`</${kind}>`, start);
    yield { open, body: end < 0 ? '' : xml.slice(start, end) };
  }
}

/** A texture's name as the map sheets key it: its file name without `.dds`, lower case. */
const textureName = (path: string): string =>
  path
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.dds$/i, '')
    .toLowerCase();

/** What a unit's actor gives a card. */
export interface ActorInfo {
  parent: string | null;
  /** The unit it shows, when not the actor's own id. */
  unit: string | null;
  /** Its portraits (GroupIcon), one per team where there are two, Order's first; null unset. */
  portraits: string[] | null;
  /** Its description's string id (InfoText); null unset. */
  description: string | null;
}

/** Every unit actor (CActorUnit) of catalogs in load order, the later's fields winning. */
export function readActors(catalogs: readonly string[]): Map<string, ActorInfo> {
  const actors = new Map<string, ActorInfo>();
  for (const xml of catalogs) {
    for (const { open, body } of elements(xml, 'CActorUnit')) {
      const id = attribute(open, 'id');
      if (!id) continue;
      const actor = actors.get(id) ?? {
        parent: null,
        unit: null,
        portraits: null,
        description: null,
      };
      actor.parent = attribute(open, 'parent') ?? actor.parent;
      actor.unit = attribute(open, 'unitName') ?? actor.unit;
      const icon = /<GroupIcon>([\s\S]*?)<\/GroupIcon>/.exec(body)?.[1];
      if (icon) {
        const images = [...icon.matchAll(/<Image\s+value="([^"]+)"/g)].map((m) =>
          textureName(m[1]!),
        );
        if (images.length) actor.portraits = images;
      }
      const info = /<InfoText\s+value="([^"]*)"/.exec(body)?.[1];
      if (info !== undefined) actor.description = info || null;
      actors.set(id, actor);
    }
  }
  return actors;
}

/** An actor's field, its own or the nearest parent's. */
function inherited<K extends 'portraits' | 'description'>(
  actors: ReadonlyMap<string, ActorInfo>,
  id: string,
  field: K,
): ActorInfo[K] {
  const seen = new Set<string>();
  for (let at: string | null = id; at && !seen.has(at); at = actors.get(at)?.parent ?? null) {
    seen.add(at);
    const value = actors.get(at)?.[field];
    if (value) return value;
  }
  return null;
}

/**
 * One level of a veterancy behaviour: what it adds, by field (`VitalMaxArray.Life`,
 * `DamageDealtScaled.Basic`, `KillXPBonus`).
 */
export type ScalingLevel = Record<string, number>;

/**
 * Every veterancy behaviour (CBehaviorVeterancy) of catalogs in load order: its levels, the first
 * the unit's own (rank 0). A later catalog's levels replace the earlier's, by index where it says.
 */
export function readVeterancy(catalogs: readonly string[]): Map<string, ScalingLevel[]> {
  const behaviours = new Map<string, ScalingLevel[]>();
  for (const xml of catalogs) {
    for (const { open, body } of elements(xml, 'CBehaviorVeterancy')) {
      const id = attribute(open, 'id');
      if (!id) continue;
      const parent = attribute(open, 'parent');
      const levels = [...(behaviours.get(id) ?? (parent ? (behaviours.get(parent) ?? []) : []))];
      let next = 0;
      for (const { open: levelOpen, body: levelBody } of elements(body, 'VeterancyLevelArray')) {
        const index = Number(attribute(levelOpen, 'index') ?? next);
        next = index + 1;
        const level: ScalingLevel = {};
        for (const { open: modOpen, body: modBody } of elements(levelBody, 'Modification')) {
          for (const [, name, value] of modOpen.matchAll(/\s(\w+)="([^"]*)"/g)) {
            if (name && value !== undefined && !Number.isNaN(Number(value)))
              level[name] = Number(value);
          }
          for (const [, name, rest] of modBody.matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
            const value = attribute(rest!, 'value');
            if (value === undefined || Number.isNaN(Number(value))) continue;
            const key = attribute(rest!, 'index') ? `${name}.${attribute(rest!, 'index')}` : name!;
            level[key] = (level[key] ?? 0) + Number(value);
          }
        }
        levels[index] = level;
      }
      behaviours.set(id, levels);
    }
  }
  return behaviours;
}

// ── Trigger scripts: camp types and scaling ticks ───────────────────────────────────────────────

/** A value a script sets: a number, a flag, a unit or behaviour id, or a string id. */
type GalaxyValue = number | boolean | string | { string: string } | null;

/**
 * The constants scripts declare (`const fixed X_C = 30.0;`) and the constant-named globals their
 * initialization sets (`libMapM_gv_genericMercCampInitialSpawnDelay_C = 30.0;`), by name, as written.
 */
function constants(scripts: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const script of scripts) {
    for (const [, name, value] of script.matchAll(/\bconst\s+\w+\s+(\w+)\s*=\s*([^;]+);/g)) {
      found.set(name!, value!.trim());
    }
    for (const [, name, value] of script.matchAll(/^\s*(lib\w+_gv_\w+_C)\s*=\s*([^;]+);/gm)) {
      if (!found.has(name!)) found.set(name!, value!.trim());
    }
  }
  return found;
}

/** A script expression's value, with the call's arguments and the scripts' constants. */
function evaluate(
  expression: string,
  params: ReadonlyMap<string, string>,
  consts: ReadonlyMap<string, string>,
  depth = 0,
): GalaxyValue {
  let text = expression.trim();
  while (/^\(.*\)$/.test(text) && depth < 8) text = text.slice(1, -1).trim();
  if (params.has(text)) return evaluate(params.get(text)!, new Map(), consts, depth + 1);
  if (consts.has(text) && depth < 8) return evaluate(consts.get(text)!, params, consts, depth + 1);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true' || text === 'false') return text === 'true';
  const string = /^StringExternal\("([^"]+)"\)$/.exec(text);
  if (string) return { string: string[1]! };
  const literal = /^"([^"]*)"$/.exec(text);
  if (literal) return literal[1]!;
  const ranks = /CatalogFieldValueCount\(c_gameCatalogBehavior,\s*"([^"]+)"/.exec(text);
  if (ranks) return `behaviour:${ranks[1]}`;
  if (/^\w+$/.test(text)) return text;
  return null;
}

/**
 * A camp type's number: the scripts index a camp type's defender and merc data by the same number
 * (libMapM_ge_JungleCampDefenderTypes_Knights and …MercTypes_Ogres are both 2).
 */
const campNumber = (value: GalaxyValue): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** What the scripts set for a camp type, field by field as they name them. */
interface CampFields {
  defender: Map<string, GalaxyValue>;
  merc: Map<string, GalaxyValue>;
  /** Its level by rank (lv_campLevel). */
  levels: number[];
  defenderScaling: string | null;
  mercScaling: string | null;
}

/** A function the scripts declare: its parameters and body, and which script declares it. */
interface GalaxyFunction {
  params: string[];
  body: string;
  script: number;
}

/** Every function scripts declare, by name. */
function functions(scripts: readonly string[]): Map<string, GalaxyFunction> {
  const found = new Map<string, GalaxyFunction>();
  for (const [index, script] of scripts.entries()) {
    for (const match of script.matchAll(/\n\w+\s+(\w+)\s*\(([^)]*)\)\s*\{\n/g)) {
      const end = script.indexOf('\n}\n', match.index!);
      if (end < 0) continue;
      const params = match[2]!
        .split(',')
        .map((p) => p.trim().split(/\s+/).pop()!)
        .filter(Boolean);
      found.set(match[1]!, {
        params,
        body: script.slice(match.index! + match[0].length, end),
        script: index,
      });
    }
  }
  return found;
}

/** Whether a function body sets camp data. */
const setsCamps = (body: string): boolean =>
  /libMapM_gv_dataJungleCamp(Defender|Merc)Data\[/.test(body);

/**
 * Runs a body's camp data statements in order, with its call's arguments: which camp type the
 * index names (`lv_campType = (…)`), each field it sets, its level-by-rank table, and the scaling
 * behaviours it names.
 */
function runCampStatements(
  body: string,
  params: ReadonlyMap<string, string>,
  consts: ReadonlyMap<string, string>,
  camps: Map<number, CampFields>,
): void {
  const locals = new Map<string, GalaxyValue>();
  let rank = 0;
  let rankToStart = 0;
  const campOf = (index: string): CampFields | null => {
    const value = locals.has(index.trim())
      ? locals.get(index.trim())!
      : evaluate(index, params, consts);
    const id = campNumber(value);
    if (id === null) return null;
    if (!camps.has(id))
      camps.set(id, {
        defender: new Map(),
        merc: new Map(),
        levels: [],
        defenderScaling: null,
        mercScaling: null,
      });
    return camps.get(id)!;
  };
  // the loop that sets every rank before scaling starts to one level, as one statement: its
  // header's semicolons would split it
  const statements = body.replace(
    /for\s*\([^{]*\)\s*\{\s*libMapM_gv_dataJungleCampDefenderData\[([^\]]+)\]\.lv_campLevel\[lv_rank\]\s*=\s*(\d+);\s*\}/g,
    '__levelsBeforeScaling($1, $2);',
  );
  for (const raw of statements.split(';')) {
    // the statement itself: without comments, or the blocks it follows or opens
    const statement = raw
      .replace(/\/\/[^\n]*/g, '')
      .replace(/^[\s\S]*[{}]/, '')
      .trim();
    const local = /^(lv_\w+)\s*=\s*(.+)$/s.exec(statement);
    if (local && !local[1]!.startsWith('lv_rank')) {
      locals.set(local[1]!, evaluate(local[2]!, params, consts));
      continue;
    }
    if (/^lv_rankToStartScaling\s*=/.test(statement)) {
      rankToStart = Number(/=\s*(\d+)/.exec(statement)?.[1] ?? 0);
      continue;
    }
    if (/^lv_rank\s*=\s*lv_rankToStartScaling$/.test(statement)) rank = rankToStart;
    else if (/^lv_rank\s*=\s*0$/.test(statement)) rank = 0;
    else if (/^lv_rank\s*\+=\s*1$/.test(statement)) rank += 1;
    const before = /^__levelsBeforeScaling\(([^,]+),\s*(\d+)\)$/.exec(statement);
    if (before) {
      const camp = campOf(before[1]!);
      if (camp) for (let r = 0; r < rankToStart; r++) camp.levels[r] = Number(before[2]);
      continue;
    }
    const level =
      /libMapM_gv_dataJungleCampDefenderData\[([^\]]+)\]\.lv_campLevel\[lv_rank\]\s*=\s*(\d+)$/.exec(
        statement,
      );
    if (level) {
      const camp = campOf(level[1]!);
      if (camp) camp.levels[rank] = Number(level[2]);
      continue;
    }
    const field =
      /libMapM_gv_dataJungleCamp(Defender|Merc)Data\[([^\]]+)\]\.(lv_\w+(?:\[\d+\])?)\s*=\s*(.+)$/s.exec(
        statement,
      );
    if (field) {
      const camp = campOf(field[2]!);
      if (!camp) continue;
      const value = evaluate(field[4]!, params, consts);
      const target = field[1] === 'Defender' ? camp.defender : camp.merc;
      target.set(field[3]!, value);
      // a rank count names the scaling behaviour it counts the levels of
      if (
        field[3] === 'lv_numberOfRanks' &&
        typeof value === 'string' &&
        value.startsWith('behaviour:')
      ) {
        const behaviour = value.slice('behaviour:'.length);
        if (field[1] === 'Defender') camp.defenderScaling ??= behaviour;
        else camp.mercScaling = behaviour;
      }
      continue;
    }
    const scaling =
      /libMapM_gf_DataInitializeScalingDataFor(Defender|Merc)\(([^,]+),\s*"([^"]+)"\)/.exec(
        statement,
      );
    if (scaling) {
      const camp = campOf(scaling[2]!);
      if (!camp) continue;
      if (scaling[1] === 'Defender') camp.defenderScaling = scaling[3]!;
      else camp.mercScaling = scaling[3]!;
    }
  }
}

/** The arguments of each call to a function in scripts. */
function* calls(scripts: readonly string[], name: string): Generator<string[]> {
  for (const script of scripts) {
    for (const match of script.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
      // the declaration itself (a type before it on its line) is no call
      const line = script.slice(script.lastIndexOf('\n', match.index! - 1) + 1, match.index!);
      if (/^\s*\w+\s+$/.test(line)) continue;
      let depth = 1;
      let i = match.index! + match[0].length;
      const start = i;
      for (; i < script.length && depth; i++) {
        if (script[i] === '(') depth++;
        else if (script[i] === ')') depth--;
      }
      const inside = script.slice(start, i - 1);
      const args: string[] = [];
      let level = 0;
      let from = 0;
      for (let j = 0; j < inside.length; j++) {
        if (inside[j] === '(') level++;
        else if (inside[j] === ')') level--;
        else if (inside[j] === ',' && level === 0) {
          args.push(inside.slice(from, j).trim());
          from = j + 1;
        }
      }
      args.push(inside.slice(from).trim());
      yield args;
    }
  }
}

/** A camp type as a card shows it. */
export interface CampType {
  /** The scripts' name for it (`SiegeGiants`, `SiegeCamp1`). */
  id: string;
  /** The game's group for it, as it treats them (libMapM: siege, bruiser and boss camps). */
  category: 'siege' | 'bruiser' | 'boss' | 'doubloons' | 'other';
  /** Its label's string id (the minimap's: `Siege Giants`); null when none. */
  label: string | null;
  /** Its defenders and how many of each. */
  defenders: { unit: string; count: number }[];
  /** The mercenaries its capture sends into lane, and how many of each. */
  mercs: { unit: string; count: number }[];
  respawnSeconds: number | null;
  /** How long after the gates open it first comes up. */
  firstSpawnSeconds: number | null;
  elite: boolean;
  soloable: boolean;
  captureXp: number | null;
  /** The veterancy behaviours its defenders and its mercenaries scale by. */
  defenderScaling: string | null;
  mercScaling: string | null;
  /** Its level by rank (scaling tick), where the scripts give one. */
  levels: number[];
}

/** The game's group for a camp type by its id, as the map mechanics library tests them. */
function category(id: string): CampType['category'] {
  if (/^(SiegeGiants|SiegeCamp\d)$/.test(id)) return 'siege';
  if (/^(Knights|BruiserCamp\d)$/.test(id)) return 'bruiser';
  if (/^(GraveGolem|BossCamp\d)$/.test(id)) return 'boss';
  if (id === 'Doubloons') return 'doubloons';
  return 'other';
}

/** Units and how many of each, from an indexed list (lv_creepUnitTypes[1…]). */
function counted(
  fields: ReadonlyMap<string, GalaxyValue>,
  list: string,
): { unit: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const [key, value] of fields) {
    if (key.startsWith(`${list}[`) && typeof value === 'string' && value)
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([unit, count]) => ({ unit, count }));
}

/**
 * Every camp type the scripts of a map's mods define, in load order; `own` is where the map's own
 * mods' scripts start (after the base data's).
 */
export function readCampTypes(scripts: readonly string[], own = 0): CampType[] {
  const consts = constants(scripts);
  const declared = functions(scripts);
  const camps = new Map<number, CampFields>();
  // each camp type's name, by its number: the defender type's (Knights, not Ogres)
  const names = new Map<number, string>();
  for (const [name, value] of consts) {
    const id = /^libMapM_ge_JungleCampDefenderTypes_(\w+)$/.exec(name)?.[1];
    if (id && id !== 'Custom') names.set(Number(value), id);
  }
  // a helper of the map's own mods none of their scripts calls (the map's script does, in its
  // archive) still defines one of its camp types: run once under a number of its own, named for
  // the helper
  let unnamed = 1000;
  for (const [name, fn] of declared) {
    if (!setsCamps(fn.body)) continue;
    // a helper taking the camp type: run for each call, with its arguments
    if (fn.params.length && /lp_campType|lp_defenderType|lp_mercType/.test(fn.params.join())) {
      const found = [...calls(scripts, name)];
      for (const args of found) {
        const params = new Map(fn.params.map((p, i) => [p, args[i] ?? '']));
        runCampStatements(fn.body, params, consts, camps);
      }
      if (!found.length && fn.script >= own && /lp_campType/.test(fn.params[0] ?? '')) {
        const own = unnamed++;
        names.set(own, name.replace(/^\w+?_gf_(Initialize)?/, ''));
        const params = new Map(fn.params.map((p, i) => [p, i === 0 ? String(own) : '']));
        runCampStatements(fn.body, params, consts, camps);
      }
    } else runCampStatements(fn.body, new Map(), consts, camps);
  }
  const number = (v: GalaxyValue | undefined): number | null => (typeof v === 'number' ? v : null);
  return [...camps].flatMap(([key, c]): CampType[] => {
    const id = names.get(key);
    // a camp type the map's scripts don't set up (no defenders) is no camp of the map
    if (!id || !counted(c.defender, 'lv_creepUnitTypes').length) return [];
    const label = c.defender.get('lv_campTypeMinimapLabel');
    return [
      {
        id,
        category: category(id),
        label: label && typeof label === 'object' ? label.string : null,
        defenders: counted(c.defender, 'lv_creepUnitTypes'),
        mercs: counted(c.merc, 'lv_spawnedMinionUnitTypes'),
        respawnSeconds: number(c.defender.get('lv_respawnTime')),
        firstSpawnSeconds: number(c.defender.get('lv_initialSpawnDelay')),
        elite: c.defender.get('lv_campIsElite') === true,
        soloable: c.defender.get('lv_campIsSoloable') === true,
        captureXp: number(c.defender.get('lv_xPAwardForCapture')),
        defenderScaling: c.defenderScaling,
        mercScaling: c.mercScaling,
        levels: c.levels.filter((l) => l !== undefined),
      },
    ];
  });
}

/** How the game counts scaling: a tick every `tickSeconds` from the gates opening, at most `maxTicks`. */
export interface ScalingTicks {
  tickSeconds: number;
  maxTicks: number;
}

/** The scaling tick's length and cap, from the base data's scripts. */
export function readScalingTicks(scripts: readonly string[]): ScalingTicks {
  const all = scripts.join('\n');
  const tick = /libGame_gv_bALScalingTimerDuration\s*=\s*([\d.]+)\s*;/.exec(all)?.[1];
  const max = /libCore_gv_dataScalingMaxScalingTicks\s*=\s*(\d+)\s*;/.exec(all)?.[1];
  return { tickSeconds: Number(tick ?? 60), maxTicks: Number(max ?? 60) };
}

// ── Strings ─────────────────────────────────────────────────────────────────────────────────────

/** Strings in load order, the later winning, by id. */
export function readStrings(texts: readonly string[]): Map<string, string> {
  const strings = new Map<string, string>();
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const at = line.indexOf('=');
      if (at > 0) strings.set(line.slice(0, at), line.slice(at + 1).trimEnd());
    }
  }
  return strings;
}

// ── A map's units ───────────────────────────────────────────────────────────────────────────────

/** What a unit card shows of a unit, besides its stats (HDP's unit data). */
export interface UnitInfo {
  /** Its portraits, one per team where the map has two (Order's first); none when it has none. */
  portraits: string[];
  /** The string ids of its name and description; null when the game has none. */
  name: string | null;
  description: string | null;
}

/** A map's camps and units, and the strings they name in every locale. */
export interface MapUnits {
  camps: CampType[];
  units: Record<string, UnitInfo>;
  /** Each veterancy behaviour its units scale by: its levels. */
  scaling: Record<string, ScalingLevel[]>;
  /** By the game's locale folder name (`enus`): each string id the map names, and its text. */
  strings: Record<string, Record<string, string>>;
}

/** Every map's camps and units (MapUnits), by the map's English title. */
export function mapUnits(
  maps: ReadonlyMap<string, readonly string[]>,
  mods: ReadonlyMap<string, ModText>,
  titles: readonly string[],
): { ticks: ScalingTicks; maps: Record<string, MapUnits> } {
  const ticks = readScalingTicks(mods.get(BASE_MOD)?.galaxy ?? []);
  const result: Record<string, MapUnits> = {};
  for (const title of titles) {
    const own = maps.get(title);
    if (!own) continue;
    const order = loadOrder(own, mods)
      .map((name) => mods.get(name)!)
      .filter(Boolean);
    const catalogs = order.flatMap((m) => m.xml);
    const actors = readActors(catalogs);
    const veterancy = readVeterancy(catalogs);
    const camps = readCampTypes(
      order.flatMap((m) => m.galaxy),
      order[0]?.galaxy.length ?? 0,
    );
    const wanted = new Set<string>([
      ...camps.flatMap((c) => [...c.defenders, ...c.mercs].map((u) => u.unit)),
      ...[...actors.keys()].filter((id) => STRUCTURE.test(id)),
    ]);
    const units: Record<string, UnitInfo> = {};
    for (const unit of [...wanted].sort()) {
      const actor = actors.has(unit) ? unit : [...actors].find(([, a]) => a.unit === unit)?.[0];
      units[unit] = {
        portraits: actor ? (inherited(actors, actor, 'portraits') ?? []) : [],
        name: `Unit/Name/${unit}`,
        description: actor ? inherited(actors, actor, 'description') : null,
      };
    }
    const behaviours = new Set(
      camps.flatMap((c) => [c.defenderScaling, c.mercScaling]).filter((b): b is string => !!b),
    );
    const scaling = Object.fromEntries(
      [...behaviours].sort().map((b) => [b, veterancy.get(b) ?? []]),
    );
    // the strings it names, in each locale its mods have
    const ids = new Set<string>([
      ...camps.map((c) => c.label).filter((l): l is string => !!l),
      ...Object.values(units).flatMap((u) =>
        [u.name, u.description].filter((s): s is string => !!s),
      ),
    ]);
    const locales = new Set(order.flatMap((m) => [...m.strings.keys()]));
    const strings: MapUnits['strings'] = {};
    for (const locale of [...locales].sort()) {
      const texts = readStrings(order.map((m) => m.strings.get(locale) ?? ''));
      strings[locale] = Object.fromEntries(
        [...ids].sort().flatMap((id) => (texts.has(id) ? [[id, texts.get(id)!]] : [])),
      );
    }
    // a unit without a name in the game has none
    for (const info of Object.values(units)) {
      if (info.name && !strings['enus']?.[info.name]) info.name = null;
      if (info.description && !strings['enus']?.[info.description]) info.description = null;
    }
    result[title] = { camps, units, scaling, strings };
  }
  return { ticks, maps: result };
}
