// What a stored extraction is (lib/sources.ts), readable without the rest of the store: the
// update's plan job runs with no packages installed.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, type Channel } from './channels.ts';

/** What a stored extraction is. */
export interface SourceMeta {
  readonly game: string;
  /** lib/extraction.ts EXTRACTION_KEY, for our own extractions. */
  readonly extraction?: string;
  /** Where it came from: our own HDP run, or HeroesToolChest's published data. */
  readonly origin: 'hdp' | 'heroes-data2';
}

/** The newest stored build's meta (sources/<channel>/latest/meta.json); null before the first. */
export async function latestMeta(channel: Channel): Promise<SourceMeta | null> {
  try {
    return JSON.parse(
      await readFile(join(ROOT, 'sources', channel, 'latest', 'meta.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}
