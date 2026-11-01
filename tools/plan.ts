// What an update of a channel still has to do, from where things stand: the game version on
// the patch server, the version the channel's folder holds, whether that version is released,
// and whether it's deployed. So a rerun after a failure carries on where the last one stopped.
//
//   node tools/plan.ts <live|ptr> [--rebuild]
//
// --rebuild builds the same game version again (a tool fix): the next revision, or the same one
// while it's unreleased. It builds from the extraction stored in sources/ when that one was made
// with the current extraction settings (lib/extraction.ts), and extracts again otherwise.
//
// Prints, and writes to $GITHUB_OUTPUT in CI: game, revision, version, tag, and the stages to
// run: extract, build, release, deploy (true/false); locales: the extraction's locales (JSON);
// hdp: the HDP version it runs.
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import {
  asChannel,
  channelVersion,
  formatGameVersion,
  releaseVersion,
  serverVersion,
} from './lib/channels.ts';
import { EXTRACTION_KEY, EXTRACTION_LOCALES, HDP_VERSION, releaseTag } from './lib/extraction.ts';
import { latestMeta } from './lib/sources.ts';

const REPOSITORY = process.env['GITHUB_REPOSITORY'] ?? 'myrddraall/heroes-assets';

const channel = asChannel(process.argv[2]);
const rebuild = process.argv.includes('--rebuild');

const gh = (...args: string[]): string | null => {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};

/** A published (not draft) release's attachments, or null when there's no such release. */
function releaseAssets(version: string): string[] | null {
  const json = gh(
    'release',
    'view',
    releaseTag(version),
    '-R',
    REPOSITORY,
    '--json',
    'isDraft,assets',
  );
  if (!json) return null;
  const release = JSON.parse(json) as { isDraft: boolean; assets: { name: string }[] };
  return release.isDraft ? null : release.assets.map((a) => a.name);
}

/** The version of a channel the Pages site serves now (the gh-pages branch's index.json). */
function deployedVersion(): string | undefined {
  const content = gh(
    'api',
    `repos/${REPOSITORY}/contents/index.json?ref=gh-pages`,
    '--jq',
    '.content',
  );
  if (!content) return undefined;
  const index = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
  return index[channel]?.version;
}

const server = await serverVersion(channel);
const game = formatGameVersion(server);
const folder = await channelVersion(channel);
const sameGame = folder?.game === game;

const stored = await latestMeta(channel);
let plan: { revision: number; extract: boolean; build: boolean };
if (sameGame && !rebuild) {
  // the folder holds this game already: what's left is releasing and deploying it
  plan = { revision: folder.revision, extract: false, build: false };
} else if (sameGame) {
  plan = {
    // an unreleased revision is built again under the same number
    revision: releaseAssets(folder.version) ? folder.revision + 1 : folder.revision,
    extract: stored?.game !== game || stored.extraction !== EXTRACTION_KEY,
    build: true,
  };
} else {
  plan = { revision: 0, extract: true, build: true };
}

const version = releaseVersion(channel, server, plan.revision);
const released = !plan.build && releaseAssets(version) !== null;
const deployed = released && deployedVersion() === version;

const outputs = {
  game,
  revision: String(plan.revision),
  version,
  tag: releaseTag(version),
  extract: String(plan.extract),
  build: String(plan.build),
  release: String(!released),
  deploy: String(!deployed),
  locales: JSON.stringify(EXTRACTION_LOCALES),
  hdp: HDP_VERSION,
};
const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
console.log(`${channel}: server ${game}, folder ${folder?.version ?? 'empty'}`);
console.log(lines.join('\n'));
if (process.env['GITHUB_OUTPUT']) {
  await appendFile(process.env['GITHUB_OUTPUT'], `${lines.join('\n')}\n`);
}
