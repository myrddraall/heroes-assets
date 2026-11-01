// Records a channel's new build: <channel>/version.json, and the release version in
// .publish/versions.yml (through git-flow's own reader and writer, as `gitflow version` does).
//
//   node tools/set-version.ts <live|ptr> <game version> <revision>
import { findVersionsFile, readVersionsFile, writeVersionsFile } from '@cpdevtools/git-flow';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  asChannel,
  parseGameVersion,
  releaseVersion,
  ROOT,
  type ChannelVersion,
} from './lib/channels.ts';
import { EXTRACTION_KEY, HDP_VERSION } from './lib/extraction.ts';

const [, , channelArg, game, revisionArg] = process.argv;
const channel = asChannel(channelArg);
if (!game || !revisionArg) {
  throw new Error('Usage: set-version.ts <live|ptr> <game version> <revision>');
}
const revision = Number(revisionArg);
const version = releaseVersion(channel, parseGameVersion(game), revision);

const record: ChannelVersion = {
  game,
  revision,
  version,
  hdp: HDP_VERSION,
  extraction: EXTRACTION_KEY,
};
await writeFile(join(ROOT, channel, 'version.json'), `${JSON.stringify(record, null, 2)}\n`);

const versionsPath = await findVersionsFile(ROOT);
if (!versionsPath) throw new Error('No .publish/versions.yml');
const versions = await readVersionsFile(versionsPath);
versions['0.0.0-MAIN'] = version;
await writeVersionsFile(versionsPath, versions);
console.log(`${channel}: ${game} revision ${revision} → ${version}`);
