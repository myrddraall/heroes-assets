import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The game's two servers, each kept in its own folder at the repository root. */
export type Channel = 'live' | 'ptr';

export const CHANNELS: readonly Channel[] = ['live', 'ptr'];

/** The repository root. */
export const ROOT = join(import.meta.dirname, '..', '..');

/** Blizzard's product code for each channel on the patch server. */
const PRODUCTS: Record<Channel, string> = { live: 'hero', ptr: 'herot' };

/** The game's locales: Heroes Data Parser's name for each, and the BCP 47 tag the output uses. */
export const LOCALES: Readonly<Record<string, string>> = {
  enus: 'en-US',
  dede: 'de-DE',
  eses: 'es-ES',
  esmx: 'es-MX',
  frfr: 'fr-FR',
  itit: 'it-IT',
  kokr: 'ko-KR',
  plpl: 'pl-PL',
  ptbr: 'pt-BR',
  ruru: 'ru-RU',
  zhcn: 'zh-CN',
  zhtw: 'zh-TW',
};

/** A game version as the patch server gives it: `2.57.0.98348`. */
export interface GameVersion {
  readonly major: number;
  readonly minor: number;
  readonly revision: number;
  readonly build: number;
}

/** What a channel's folder holds: `<channel>/version.json`. */
export interface ChannelVersion {
  /** The game version the files were extracted from, `2.57.0.98348`. */
  readonly game: string;
  /** Rebuilds of the same game build (tool fixes), from 0. */
  readonly revision: number;
  /** The release version: see {@link releaseVersion}. */
  readonly version: string;
  /** The Heroes Data Parser version that extracted the files. */
  readonly hdp: string;
  /** What the extraction holds besides the game build (lib/extraction.ts EXTRACTION_KEY). */
  readonly extraction?: string;
}

export function asChannel(value: string | undefined): Channel {
  if (value === 'live' || value === 'ptr') return value;
  throw new Error(`Expected a channel (live or ptr), got ${value ?? 'nothing'}`);
}

export function parseGameVersion(text: string): GameVersion {
  const parts = text.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Not a game version: ${text}`);
  }
  const [major, minor, revision, build] = parts as [number, number, number, number];
  return { major, minor, revision, build };
}

export const formatGameVersion = (v: GameVersion): string =>
  `${v.major}.${v.minor}.${v.revision}.${v.build}`;

/**
 * The release version for a game version and a tool revision: the game's major and minor, then
 * the build × 100 + revision as the patch (`2.57.0.98348`, revision 1 → `2.57.9834801`), so tool
 * fixes stay stable releases and every version sorts in order. PTR builds are `-ptr` prereleases.
 * The game's own third number is left out: every hotfix comes with a new build anyway.
 */
export function releaseVersion(channel: Channel, game: GameVersion, revision: number): string {
  if (!Number.isInteger(revision) || revision < 0 || revision > 99) {
    throw new Error(`Tool revision out of range (0–99): ${revision}`);
  }
  const version = `${game.major}.${game.minor}.${game.build * 100 + revision}`;
  return channel === 'ptr' ? `${version}-ptr` : version;
}

/** The game version a channel's server is on now, from Blizzard's patch server (US region). */
export async function serverVersion(channel: Channel): Promise<GameVersion> {
  const url = `http://us.patch.battle.net:1119/${PRODUCTS[channel]}/versions`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  const lines = (await response.text()).split('\n').filter((l) => l && !l.startsWith('##'));
  const columns = lines[0]!.split('|').map((c) => c.split('!')[0]);
  const name = columns.indexOf('VersionsName');
  const us = lines.slice(1).find((l) => l.startsWith('us|'));
  if (name < 0 || !us) throw new Error(`${url}: no US version in\n${lines.join('\n')}`);
  return parseGameVersion(us.split('|')[name]!);
}

/** The version a channel's folder holds, or null before its first build. */
export async function channelVersion(channel: Channel): Promise<ChannelVersion | null> {
  try {
    return JSON.parse(await readFile(join(ROOT, channel, 'version.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
